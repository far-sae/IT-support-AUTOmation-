/**
 * Runbook orchestrator.
 *
 * Lifecycle for a newly-created ticket:
 *   1. `prepareKbDeflection(ctx)` so the KB matcher has its candidate cached.
 *   2. `pickRunbook(ctx)` picks the highest-confidence runbook the org hasn't
 *      disabled (≥ MIN_CONFIDENCE).
 *   3. `runRunbook(ctx, runbook)` creates a RunbookExecution row, runs
 *      `execute()`, posts the audit comment, updates the row's status, and
 *      (for LOW-risk SUCCEEDED outcomes that asked for it) closes the ticket.
 *
 * All DB writes inside this module happen inside the caller's tenant ALS
 * context — the engine itself doesn't enter a context, so the Prisma
 * extension's per-tenant filter still applies.
 */

import type { Ticket } from "@prisma/client";
import { RunbookRisk, RunbookStatus, TicketStatus } from "@prisma/client";

import { prisma, basePrismaUnscoped } from "../db.js";
import { emit } from "../realtime/socket.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { createSurveyForTicket } from "../survey/survey.js";
import { evaluatePolicies } from "../policies/engine.js";
import { indexResolvedTicket } from "../memory/store.js";

import type { Runbook, RunbookContext } from "./types.js";
import { RUNBOOKS } from "./registry.js";
import { prepareKbDeflection } from "./kb_deflection.js";
import type { TriageResult } from "../triage.js";

const MIN_CONFIDENCE = 0.5;

export interface PickResult {
  runbook: Runbook;
  confidence: number;
  reason: string;
}

async function disabledKeys(organizationId: string): Promise<Set<string>> {
  const org = await basePrismaUnscoped.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const settings = parseOrgSettings(org?.settings);
  return new Set((settings as { disabledRunbooks?: string[] }).disabledRunbooks ?? []);
}

export async function pickRunbook(ctx: RunbookContext): Promise<PickResult | null> {
  // Let runbooks that need DB prep (kb_deflection) populate their caches.
  await prepareKbDeflection(ctx);

  const disabled = await disabledKeys(ctx.ticket.organizationId);

  let best: PickResult | null = null;
  for (const rb of RUNBOOKS) {
    if (disabled.has(rb.key)) continue;
    const m = rb.match(ctx);
    if (m.confidence < MIN_CONFIDENCE) continue;
    if (!best || m.confidence > best.confidence) {
      best = { runbook: rb, confidence: m.confidence, reason: m.reason };
    }
  }
  return best;
}

export async function runRunbook(ctx: RunbookContext, pick: PickResult): Promise<void> {
  const { runbook, confidence, reason } = pick;

  // Phase 11 — consult the policy engine (risk + guard-rails) BEFORE we
  // create the execution row. A blocked policy still records a row so the
  // brain (and the audit log) can see the denied attempt.
  const decision = await evaluatePolicies({
    ticket: ctx.ticket, runbook, organizationId: ctx.ticket.organizationId,
  });

  const initialStatus =
    decision.verdict.decision === "DENY"
      ? (decision.verdict.escalate ? RunbookStatus.AWAITING_AGENT : RunbookStatus.CANCELLED)
      : runbook.risk === "HIGH" ? RunbookStatus.AWAITING_AGENT
      : RunbookStatus.RUNNING;

  const execution = await prisma.runbookExecution.create({
    data: {
      organizationId: ctx.ticket.organizationId,
      ticketId: ctx.ticket.id,
      runbookKey: runbook.key,
      status: initialStatus,
      risk: RunbookRisk[runbook.risk],
      confidence,
      decision: {
        matchReason: reason,
        riskScore: decision.risk.score,
        riskReasons: decision.risk.reasons,
        policy: decision.policyKey ?? null,
        policyDecision: decision.verdict.decision,
        policyReason: "reason" in decision.verdict ? decision.verdict.reason : undefined,
      } as object,
    },
  });

  if (decision.verdict.decision === "DENY") {
    // Audit comment — internal note so the brain log shows what blocked it.
    const fallbackAuthor = await prisma.user.findFirst({
      where: { role: "ADMIN" }, select: { id: true },
    });
    const authorId = ctx.ticket.submitterUserId ?? fallbackAuthor?.id;
    if (authorId) {
      await prisma.comment.create({
        data: {
          organizationId: ctx.ticket.organizationId, ticketId: ctx.ticket.id, authorId,
          body: `[Policy] ${decision.policyKey} blocked ${runbook.key}: ${decision.verdict.reason}` +
                (decision.verdict.escalate ? " — escalated for agent approval." : ""),
          isInternal: true,
        },
      });
    }
    emit("ticket:updated", {
      ticketId: ctx.ticket.id, refCode: ctx.ticket.refCode, status: ctx.ticket.status,
    });
    return;
  }

  // HIGH risk → don't auto-execute; wait for an agent to click Approve.
  if (runbook.risk === "HIGH") {
    emit("ticket:updated", {
      ticketId: ctx.ticket.id, refCode: ctx.ticket.refCode, status: ctx.ticket.status,
    });
    return;
  }

  let outcome;
  try {
    outcome = await runbook.execute(ctx);
  } catch (err) {
    outcome = {
      status: "FAILED" as const,
      publicComment: "",
      decision: { error: (err as Error).message ?? String(err) },
    };
  }

  // Post the audit comments (one public, optional internal).
  const author = ctx.ticket.submitterUserId ?? null;
  // For the internal note we need a real authorId — fall back to any admin
  // in the org so the FK is satisfied.
  const fallbackAuthor = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  const authorId = author ?? fallbackAuthor?.id;

  if (outcome.publicComment && authorId) {
    await prisma.comment.create({
      data: {
        organizationId: ctx.ticket.organizationId,
        ticketId: ctx.ticket.id,
        authorId,
        body: outcome.publicComment,
        isInternal: false,
      },
    });
  }
  if (outcome.internalNote && authorId) {
    await prisma.comment.create({
      data: {
        organizationId: ctx.ticket.organizationId,
        ticketId: ctx.ticket.id,
        authorId,
        body: outcome.internalNote,
        isInternal: true,
      },
    });
  }

  // Update the execution row.
  const finalStatus = (() => {
    switch (outcome.status) {
      case "SUCCEEDED":              return RunbookStatus.SUCCEEDED;
      case "AWAITING_USER":          return RunbookStatus.AWAITING_USER;
      case "AWAITING_VERIFICATION":  return RunbookStatus.AWAITING_VERIFICATION;
      case "AWAITING_AGENT": return RunbookStatus.AWAITING_AGENT;
      case "FAILED":         return RunbookStatus.FAILED;
    }
  })();
  // For AWAITING_VERIFICATION runs (Phase 10C agent-dispatched + Phase 10B
  // MEDIUM runbooks), set a fallback verifyAt so the cron can finalize
  // even if no agent result / user signal arrives. The org's
  // verificationMinutes setting controls how long we wait.
  let verifyAt: Date | null = null;
  if (outcome.status === "AWAITING_VERIFICATION") {
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: ctx.ticket.organizationId }, select: { settings: true },
    });
    const settings = (org?.settings as { verificationMinutes?: number } | null) ?? null;
    const minutes = settings?.verificationMinutes ?? 60;
    verifyAt = new Date(Date.now() + minutes * 60 * 1000);
  }

  await prisma.runbookExecution.update({
    where: { id: execution.id },
    data: {
      status: finalStatus,
      completedAt: outcome.status === "SUCCEEDED" || outcome.status === "FAILED" ? new Date() : null,
      decision: { matchReason: reason, ...outcome.decision } as object,
      ...(verifyAt ? { verifyAt } : {}),
    },
  });

  // Phase 20 — capture this attempt's feature vector + label for ML training.
  // Only log terminal outcomes (SUCCEEDED / FAILED) so the trainer sees clean
  // positives + negatives. AWAITING_* are still in flight; their final
  // outcome is logged when settleVerifications closes them.
  if (outcome.status === "SUCCEEDED" || outcome.status === "FAILED") {
    try {
      const { logRemediationAttempt } = await import("../ml/predict.js");
      const { extractFeatures } = await import("../ml/features.js");
      const features = extractFeatures({
        ticket: { priority: ctx.ticket.priority, category: ctx.ticket.category, createdAt: ctx.ticket.createdAt },
        runbook: { risk: runbook.risk },
        matchConfidence: confidence,
        // We don't have learning stats at this engine layer; the brain layer
        // does. Treat as "no history" for the attempt log — the per-attempt
        // model will pick up the historical signal organically.
        history: { successes: 0, failures: 0 },
      });
      await logRemediationAttempt({
        organizationId: ctx.ticket.organizationId,
        ticketId: ctx.ticket.id,
        runbookExecutionId: execution.id,
        runbookKey: runbook.key,
        features,
        label: outcome.status === "SUCCEEDED" ? 1 : 0,
      });
    } catch (err) {
      console.error("[ml] attempt log failed:", err);
    }
  }

  // Close the ticket if the runbook said so (SUCCEEDED + closeTicket).
  if (outcome.status === "SUCCEEDED" && outcome.closeTicket) {
    await prisma.ticket.update({
      where: { id: ctx.ticket.id },
      data: { status: TicketStatus.RESOLVED, resolvedAt: new Date() },
    });
    try { await createSurveyForTicket(ctx.ticket.id); } catch (err) {
      console.error("[runbooks] survey send failed:", err);
    }
    // Phase 11 — index into vector memory so future tickets can recall this fix.
    try { await indexResolvedTicket(ctx.ticket.id); } catch (err) {
      console.error("[runbooks] memory index failed:", err);
    }
    emit("ticket:updated", {
      ticketId: ctx.ticket.id, refCode: ctx.ticket.refCode, status: "RESOLVED",
    });
  } else {
    emit("ticket:updated", {
      ticketId: ctx.ticket.id, refCode: ctx.ticket.refCode, status: ctx.ticket.status,
    });
  }

  emit("analytics:updated", { reason: `runbook:${runbook.key}` });
}

/** Fire-and-forget convenience used by the ticket-create handler. */
export async function autoRemediate(ticket: Ticket, triage: TriageResult): Promise<void> {
  const ctx: RunbookContext = { ticket, triage };
  try {
    const pick = await pickRunbook(ctx);
    if (!pick) return;
    await runRunbook(ctx, pick);
  } catch (err) {
    console.error("[runbooks] auto-remediate failed:", err);
  }
}

// ─── User / agent confirmations ──────────────────────────────────────

export async function confirmExecution(
  executionId: string,
  outcome: "fixed" | "still_broken",
  actor: { id: string; role: string } | null,
): Promise<{ ticketId: string; status: RunbookStatus }> {
  const exec = await prisma.runbookExecution.findUnique({
    where: { id: executionId },
    include: { ticket: true },
  });
  if (!exec) throw new Error("Execution not found");
  if (exec.status !== RunbookStatus.AWAITING_USER) {
    throw new Error(`Execution is in ${exec.status}, not AWAITING_USER`);
  }

  if (outcome === "fixed") {
    await prisma.runbookExecution.update({
      where: { id: executionId },
      data: { status: RunbookStatus.SUCCEEDED, completedAt: new Date() },
    });
    await prisma.ticket.update({
      where: { id: exec.ticketId },
      data: { status: TicketStatus.RESOLVED, resolvedAt: new Date() },
    });
    try { await createSurveyForTicket(exec.ticketId); } catch (err) {
      console.error("[runbooks] survey send failed:", err);
    }
    if (actor) {
      await prisma.comment.create({
        data: {
          organizationId: exec.organizationId,
          ticketId: exec.ticketId,
          authorId: actor.id,
          body: "Confirmed by the submitter — auto-remediation fixed the issue.",
          isInternal: true,
        },
      });
    }
    emit("ticket:updated", { ticketId: exec.ticketId, refCode: exec.ticket.refCode, status: "RESOLVED" });
    emit("analytics:updated", { reason: "runbook-confirmed" });
    return { ticketId: exec.ticketId, status: RunbookStatus.SUCCEEDED };
  }

  // still_broken
  await prisma.runbookExecution.update({
    where: { id: executionId },
    data: { status: RunbookStatus.CANCELLED, completedAt: new Date() },
  });
  if (actor) {
    await prisma.comment.create({
      data: {
        organizationId: exec.organizationId,
        ticketId: exec.ticketId,
        authorId: actor.id,
        body: "Auto-remediation didn't fix it — escalating to a human.",
        isInternal: false,
      },
    });
  }
  emit("ticket:updated", { ticketId: exec.ticketId, refCode: exec.ticket.refCode, status: exec.ticket.status });
  return { ticketId: exec.ticketId, status: RunbookStatus.CANCELLED };
}

export async function approveExecution(
  executionId: string,
  actor: { id: string },
  triage: TriageResult,
): Promise<{ ticketId: string }> {
  const exec = await prisma.runbookExecution.findUnique({
    where: { id: executionId },
    include: { ticket: true },
  });
  if (!exec) throw new Error("Execution not found");
  if (exec.status !== RunbookStatus.AWAITING_AGENT) {
    throw new Error(`Execution is in ${exec.status}, not AWAITING_AGENT`);
  }
  const runbook = RUNBOOKS.find((r) => r.key === exec.runbookKey);
  if (!runbook) throw new Error(`Unknown runbook ${exec.runbookKey}`);

  await prisma.runbookExecution.update({
    where: { id: executionId },
    data: { status: RunbookStatus.RUNNING, approvedById: actor.id },
  });

  // Run with the original triage so the runbook has the same context.
  await runRunbook({ ticket: exec.ticket, triage }, {
    runbook, confidence: exec.confidence, reason: "agent-approved",
  });
  return { ticketId: exec.ticketId };
}
