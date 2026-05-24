/**
 * Autopilot brain — agentic loop for ticket auto-resolution.
 *
 * When `USE_AI_BRAIN=true` and `ANTHROPIC_API_KEY` is set, the brain drives
 * decisions through Claude tool-use:
 *
 *   ticket → claude (with tools) → tool_use → execute tool → tool_result → claude …
 *   until claude calls `finish` (or `escalate`) or we hit BRAIN_MAX_ITERATIONS.
 *
 * Without an API key, the brain falls back to a learning-weighted version
 * of the original rule-based engine (still no human Yes/No required — runs
 * are pushed straight into AWAITING_VERIFICATION).
 *
 * Either way, the brain:
 *   • Picks one runbook (or escalates).
 *   • Calls runRunbook() through the existing engine.
 *   • Records its reasoning (chronological log of tool calls + assistant
 *     text) in `RunbookExecution.brainLog`.
 *   • Updates RemediationOutcome counters when the run finalizes.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Ticket } from "@prisma/client";
import { RunbookStatus, TicketStatus } from "@prisma/client";

import { env } from "../env.js";
import { prisma, basePrismaUnscoped } from "../db.js";
import { triage as ruleTriage, type TriageResult } from "../triage.js";
import { pickRunbook, runRunbook } from "../runbooks/engine.js";
import { RUNBOOKS, getRunbook } from "../runbooks/registry.js";
import { parseOrgSettings } from "../tenant/settings.js";
import {
  recordOutcome, signatureOf, statsForSignature, weightConfidence,
} from "../learning/store.js";
import { emit } from "../realtime/socket.js";

import {
  TOOLS, type ToolContext,
  executeRunbook, getDeviceMetrics, listRunbooks, postComment,
  querySimilarTickets, searchKb, escalate as toolEscalate,
} from "./tools.js";

export interface BrainLogEntry {
  at: string;
  role: "system" | "assistant" | "tool";
  text: string;
}

export interface BrainResult {
  status: "RESOLVED" | "AWAITING_VERIFICATION" | "ESCALATED" | "NO_ACTION";
  runbookKey?: string;
  reason: string;
}

// ─── Public entry point ─────────────────────────────────────────────

export async function decideAndExecute(
  ticket: Ticket,
  triage: TriageResult,
): Promise<BrainResult> {
  const useAi = env.USE_AI_BRAIN && Boolean(env.ANTHROPIC_API_KEY);
  if (useAi) {
    try {
      return await runAiBrain(ticket, triage);
    } catch (err) {
      console.error("[brain] AI loop failed, falling back to rules:", err);
    }
  }
  return runRuleBrain(ticket, triage);
}

/**
 * Called when a comment from the submitter arrives on a ticket that's in
 * AWAITING_VERIFICATION. If the comment hints "still broken" we re-run the
 * brain; otherwise we mark the execution succeeded early.
 */
const NEGATIVE_PHRASES = [
  "still broken", "still not working", "doesn't work", "didn't work",
  "didnt work", "doesnt work", "not fixed", "not working", "still happening",
  "still the same", "still failing", "no luck", "still locked", "same problem",
];
const POSITIVE_PHRASES = [
  "thanks", "thank you", "fixed", "worked", "working now", "all good", "great",
  "resolved", "solved", "yes",
];

export function classifySubmitterReply(body: string): "positive" | "negative" | "neutral" {
  const t = body.toLowerCase();
  for (const p of NEGATIVE_PHRASES) if (t.includes(p)) return "negative";
  for (const p of POSITIVE_PHRASES) if (t.includes(p)) return "positive";
  return "neutral";
}

// ─── Rule-engine fallback (no human Yes/No) ─────────────────────────

async function runRuleBrain(ticket: Ticket, triage: TriageResult): Promise<BrainResult> {
  // Honor per-org policy: AUTO modes allow auto-execute; HUMAN_IN_LOOP escalates.
  const policy = await currentAutonomy(ticket.organizationId);
  if (policy === "HUMAN_IN_LOOP") {
    return { status: "NO_ACTION", reason: "autonomy=HUMAN_IN_LOOP — brain stays out" };
  }

  const sig = signatureOf(triage, ticket.description);
  const allStats = await statsForSignature(ticket.organizationId, sig);

  const pick = await pickRunbook({ ticket, triage });
  if (!pick) {
    // No rule-based match. Escalate quietly via comment.
    const me = await fallbackAuthor(ticket.organizationId);
    if (me) {
      await prisma.comment.create({
        data: {
          organizationId: ticket.organizationId, ticketId: ticket.id, authorId: me,
          body: "[Autopilot] No matching runbook — escalating to a human.",
          isInternal: true,
        },
      });
    }
    return { status: "ESCALATED", reason: "no rule match" };
  }

  // Apply learning weighting and possibly switch to a different runbook
  // if a high-confidence sibling has stronger historical success.
  //
  // Phase 16: if the org has a trained MlModel active, blend the model's
  // P(success) in with the heuristic. 50/50 mix when both signals are
  // available — falls back to pure heuristic when no model exists.
  const { predictSuccess } = await import("../ml/predict.js");
  async function score(runbook: typeof RUNBOOKS[number], rawConfidence: number): Promise<{ weighted: number; reason: string }> {
    const heur = weightConfidence(rawConfidence, allStats[runbook.key]);
    const p = await predictSuccess({
      organizationId: ticket.organizationId,
      ticket: { priority: ticket.priority, category: ticket.category, createdAt: ticket.createdAt },
      runbook: { risk: runbook.risk },
      matchConfidence: rawConfidence,
      history: {
        successes: allStats[runbook.key]?.successes ?? 0,
        failures:  allStats[runbook.key]?.failures  ?? 0,
      },
    });
    if (p === null) return heur;
    const blended = heur.weighted * 0.5 + p * 0.5;
    return { weighted: blended, reason: `${heur.reason}; ml ${(p * 100).toFixed(0)}%` };
  }

  const weighted = await score(pick.runbook, pick.confidence);
  let chosen = { runbook: pick.runbook, confidence: weighted.weighted, reason: `${pick.reason}; ${weighted.reason}` };

  for (const rb of RUNBOOKS) {
    if (rb.key === chosen.runbook.key) continue;
    const s = allStats[rb.key];
    if (!s || s.attempts < 3) continue;
    const raw = rb.match({ ticket, triage });
    if (raw.confidence < 0.4) continue;
    const w = await score(rb, raw.confidence);
    if (w.weighted > chosen.confidence + 0.05) {
      chosen = { runbook: rb, confidence: w.weighted, reason: `learning-promoted: ${w.reason}` };
    }
  }

  // Respect autonomy: in REVIEW_MEDIUM_HIGH, MEDIUM/HIGH get paused.
  if (policy === "REVIEW_MEDIUM_HIGH" && chosen.runbook.risk !== "LOW") {
    // Engine will create AWAITING_AGENT for HIGH; for MEDIUM we route the same way.
    // Simplest: re-pick a LOW alternative if available.
    const lowAlt = RUNBOOKS.find((rb) => rb.risk === "LOW" && rb.match({ ticket, triage }).confidence >= 0.5);
    if (lowAlt) chosen = { runbook: lowAlt, confidence: 0.5, reason: "downgraded to LOW under REVIEW_MEDIUM_HIGH" };
  }

  // Phase 11 — consult vector memory. If the top similar past ticket was
  // resolved by a DIFFERENT runbook (that also still matches the current
  // text), promote it. This is how the brain "remembers" what worked.
  try {
    const { searchSimilar } = await import("../memory/store.js");
    const memories = await searchSimilar({
      description: ticket.description, category: triage.category, k: 3, excludeTicketId: ticket.id,
    });
    const top = memories[0];
    if (top && top.winningRunbook && top.winningRunbook !== chosen.runbook.key && top.similarity > 0.35) {
      const memRb = RUNBOOKS.find((r) => r.key === top.winningRunbook);
      if (memRb) {
        const match = memRb.match({ ticket, triage });
        if (match.confidence >= 0.35) {
          chosen = {
            runbook: memRb, confidence: match.confidence,
            reason: `memory-promoted from ${top.refCode} (sim ${top.similarity.toFixed(2)})`,
          };
        }
      }
    }
  } catch (err) {
    console.error("[brain] memory consult failed:", err);
  }

  await runRunbook({ ticket, triage }, chosen);

  const exec = await prisma.runbookExecution.findFirst({
    where: { ticketId: ticket.id, runbookKey: chosen.runbook.key },
    orderBy: { startedAt: "desc" },
  });
  await stampBrainLog(exec?.id, [
    sysLog(`Rule brain picked '${chosen.runbook.key}' — ${chosen.reason}`),
  ]);

  // Promote any AWAITING_USER → AWAITING_VERIFICATION with a verifyAt timer
  // (no human Yes/No required).
  await promoteAwaitingUser(ticket.organizationId);

  // Already-closed runs SUCCEEDED → return that.
  if (exec?.status === RunbookStatus.SUCCEEDED) {
    await recordOutcome({ organizationId: ticket.organizationId, signature: sig, runbookKey: chosen.runbook.key, outcome: "success" });
    return { status: "RESOLVED", runbookKey: chosen.runbook.key, reason: chosen.reason };
  }
  return { status: "AWAITING_VERIFICATION", runbookKey: chosen.runbook.key, reason: chosen.reason };
}

// ─── AI brain (Claude tool-use loop) ────────────────────────────────

async function runAiBrain(ticket: Ticket, triage: TriageResult): Promise<BrainResult> {
  const policy = await currentAutonomy(ticket.organizationId);
  if (policy === "HUMAN_IN_LOOP") {
    return { status: "NO_ACTION", reason: "autonomy=HUMAN_IN_LOOP — brain stays out" };
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const log: BrainLogEntry[] = [];

  const submitterUserId = ticket.submitterUserId;
  const fallback = submitterUserId ?? (await fallbackAuthor(ticket.organizationId));
  if (!fallback) return { status: "NO_ACTION", reason: "no user to attribute comments to" };
  const toolCtx: ToolContext = { ticket, authorId: fallback };

  const stats = await statsForSignature(ticket.organizationId, signatureOf(triage, ticket.description));
  const systemPrompt = buildSystemPrompt(ticket, triage, stats, policy);

  const messages: Array<Anthropic.MessageParam> = [
    { role: "user", content: `Ticket ${ticket.refCode}\n\n${ticket.description}` },
  ];

  let runbookKey: string | undefined;
  let outcomeForLearning: "success" | "failure" | "escalation" | null = null;
  let final: BrainResult = { status: "NO_ACTION", reason: "no decision" };

  for (let iter = 0; iter < env.BRAIN_MAX_ITERATIONS; iter += 1) {
    const resp = await client.messages.create({
      model: env.BRAIN_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS as unknown as Anthropic.Tool[],
      messages,
    });

    // Capture any text the model produced.
    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) {
        log.push({ at: new Date().toISOString(), role: "assistant", text: block.text.trim() });
      }
    }

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      // No more tools requested → done.
      break;
    }

    // Echo the assistant's message back so tool_result blocks line up.
    messages.push({ role: "assistant", content: resp.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const result = await dispatchTool(use, toolCtx, ticket, triage);
      log.push({ at: new Date().toISOString(), role: "tool", text: `${use.name}(${JSON.stringify(use.input)}) → ${result.content.slice(0, 280)}` });
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      });

      if (use.name === "execute_runbook" && result.meta) {
        runbookKey = result.meta.runbookKey;
        if (result.meta.outcome === "SUCCEEDED") outcomeForLearning = "success";
        else if (result.meta.outcome === "FAILED") outcomeForLearning = "failure";
      }
      if (use.name === "escalate") {
        outcomeForLearning = "escalation";
        final = { status: "ESCALATED", reason: ((use.input as { reason?: string }).reason) ?? "agent decided" };
      }
      if (use.name === "finish") {
        // Loop will exit after this batch.
      }
    }

    messages.push({ role: "user", content: toolResults });

    if (toolUses.some((u) => u.name === "finish")) break;
  }

  // Finalize: derive a status.
  if (final.status === "NO_ACTION" && runbookKey) {
    const exec = await prisma.runbookExecution.findFirst({
      where: { ticketId: ticket.id, runbookKey },
      orderBy: { startedAt: "desc" },
    });
    if (exec?.status === RunbookStatus.SUCCEEDED) {
      final = { status: "RESOLVED", runbookKey, reason: "brain ran a runbook that closed the ticket" };
    } else {
      final = { status: "AWAITING_VERIFICATION", runbookKey, reason: "brain ran a runbook, verifying" };
    }
    // Make sure verifyAt is set even if the runbook itself was MEDIUM.
    await promoteAwaitingUser(ticket.organizationId);
    if (exec) await stampBrainLog(exec.id, log);
  }

  if (outcomeForLearning && runbookKey) {
    await recordOutcome({
      organizationId: ticket.organizationId,
      signature: signatureOf(triage, ticket.description),
      runbookKey,
      outcome: outcomeForLearning,
    });
  }

  return final;
}

function buildSystemPrompt(
  ticket: Ticket,
  triage: TriageResult,
  stats: Record<string, ReturnType<typeof statsForSignature> extends Promise<infer R> ? R[keyof R] : never>,
  policy: string,
): string {
  const statSummary = Object.values(stats)
    .filter((s) => s && s.attempts > 0)
    .map((s) => `  ${s.runbookKey}: ${s.successes}/${s.attempts} succeeded`)
    .join("\n") || "  (no history yet at this ticket signature)";

  return `You are Relay's autopilot — an autonomous IT helpdesk agent. Your job is to resolve the user's ticket without human intervention.

Triage already classified this ticket:
  Category : ${triage.category}
  Priority : ${triage.priority}
  Team     : ${triage.assignedTeam}
  SLA      : ${triage.slaTarget}

Historical outcomes at this ticket's signature:
${statSummary}

Autonomy policy for this organization: ${policy}
(FULL_AUTO = run anything; REVIEW_MEDIUM_HIGH = LOW only; HUMAN_IN_LOOP = don't act.)

Workflow:
  1. Use list_runbooks to see what's available and their track record.
  2. Optionally use search_kb / query_similar_tickets / get_device_metrics for context.
  3. Pick one runbook and call execute_runbook. ONE attempt per ticket — if it fails verification later, the loop will call you again.
  4. If nothing matches, call escalate with a brief reason.
  5. Call finish when done.

Do not ask the user any questions. Do not propose solutions for the user to try — execute them. Be brief.`;
}

async function dispatchTool(
  use: Anthropic.ToolUseBlock,
  ctx: ToolContext,
  ticket: Ticket,
  triage: TriageResult,
): Promise<{ content: string; isError?: true; meta?: { outcome: "SUCCEEDED" | "AWAITING_VERIFICATION" | "FAILED"; runbookKey: string; message: string } }> {
  const inp = use.input as Record<string, unknown>;
  switch (use.name) {
    case "search_kb":             return searchKb(String(inp.query ?? ""));
    case "list_runbooks":         return listRunbooks(ticket);
    case "get_device_metrics":    return getDeviceMetrics(ticket.organizationId, String(inp.hostname ?? ""));
    case "query_similar_tickets": return querySimilarTickets(ticket.organizationId, String(inp.query ?? ""), triage.category);
    case "execute_runbook":       return executeRunbook(ctx, String(inp.runbook_key ?? ""));
    case "post_comment":          return postComment(ctx, String(inp.body ?? ""), Boolean(inp.internal));
    case "escalate":              return toolEscalate(ctx, String(inp.reason ?? ""));
    case "finish":                return { content: "done" };
    default:
      void triage;
      return { content: `unknown tool: ${use.name}`, isError: true };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

async function currentAutonomy(orgId: string): Promise<"FULL_AUTO" | "REVIEW_MEDIUM_HIGH" | "HUMAN_IN_LOOP"> {
  const org = await basePrismaUnscoped.organization.findUnique({
    where: { id: orgId }, select: { settings: true },
  });
  const s = parseOrgSettings(org?.settings);
  return s.autonomy ?? "FULL_AUTO";
}

async function fallbackAuthor(orgId: string): Promise<string | null> {
  const u = await basePrismaUnscoped.user.findFirst({
    where: { organizationId: orgId, role: "ADMIN" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return u?.id ?? null;
}

function sysLog(text: string): BrainLogEntry {
  return { at: new Date().toISOString(), role: "system", text };
}

async function stampBrainLog(executionId: string | undefined, entries: BrainLogEntry[]): Promise<void> {
  if (!executionId || entries.length === 0) return;
  const existing = await prisma.runbookExecution.findUnique({
    where: { id: executionId }, select: { brainLog: true },
  });
  const prev = Array.isArray(existing?.brainLog) ? (existing!.brainLog as unknown as BrainLogEntry[]) : [];
  await prisma.runbookExecution.update({
    where: { id: executionId },
    data: { brainLog: [...prev, ...entries] as unknown as object },
  });
}

/**
 * Convert any AWAITING_USER (legacy Phase 10A produces these on MEDIUM
 * runbooks) into AWAITING_VERIFICATION with a verifyAt timer. The cron
 * then auto-resolves them after the window expires unless a negative
 * signal arrives.
 */
async function promoteAwaitingUser(orgId: string): Promise<void> {
  const org = await basePrismaUnscoped.organization.findUnique({
    where: { id: orgId }, select: { settings: true },
  });
  const minutes = parseOrgSettings(org?.settings).verificationMinutes ?? 60;
  const verifyAt = new Date(Date.now() + minutes * 60 * 1000);

  await prisma.runbookExecution.updateMany({
    where: { status: RunbookStatus.AWAITING_USER, verifyAt: null },
    data: { status: RunbookStatus.AWAITING_VERIFICATION, verifyAt },
  });
}

/**
 * Called from the cron + the comment-create hook.
 * Finalizes any AWAITING_VERIFICATION runs whose timer has expired OR
 * whose submitter signaled "still broken".
 *
 *   • If `userSignal === "negative"` → mark FAILED, escalate, re-trigger brain.
 *   • If timer expired with no negative signal → mark SUCCEEDED + close ticket + survey.
 *
 * Returns the number of executions finalized this pass.
 */
export async function settleVerifications(args: {
  now?: Date;
  ticketId?: string;
  userSignal?: "positive" | "negative";
}): Promise<number> {
  const now = args.now ?? new Date();
  const where: Record<string, unknown> = { status: RunbookStatus.AWAITING_VERIFICATION };
  if (args.ticketId) where.ticketId = args.ticketId;
  if (!args.ticketId && !args.userSignal) where.verifyAt = { lte: now };

  const due = await prisma.runbookExecution.findMany({ where, include: { ticket: true } });

  let n = 0;
  for (const exec of due) {
    const sig = signatureOf(ruleTriage(exec.ticket.description), exec.ticket.description);
    if (args.userSignal === "negative") {
      await prisma.runbookExecution.update({
        where: { id: exec.id },
        data: { status: RunbookStatus.FAILED, completedAt: now },
      });
      await recordOutcome({
        organizationId: exec.organizationId, signature: sig, runbookKey: exec.runbookKey, outcome: "failure",
      });
      emit("ticket:updated", { ticketId: exec.ticketId, refCode: exec.ticket.refCode, status: exec.ticket.status });
      n += 1;
      continue;
    }

    // Default + userSignal=positive + timer-expired → succeed.
    await prisma.runbookExecution.update({
      where: { id: exec.id },
      data: { status: RunbookStatus.SUCCEEDED, completedAt: now },
    });
    if (exec.ticket.status !== TicketStatus.RESOLVED) {
      await prisma.ticket.update({
        where: { id: exec.ticketId },
        data: { status: TicketStatus.RESOLVED, resolvedAt: now },
      });
      try {
        const { createSurveyForTicket } = await import("../survey/survey.js");
        await createSurveyForTicket(exec.ticketId);
      } catch (err) {
        console.error("[brain] survey send failed:", err);
      }
      try {
        const { indexResolvedTicket } = await import("../memory/store.js");
        await indexResolvedTicket(exec.ticketId);
      } catch (err) {
        console.error("[brain] memory index failed:", err);
      }
    }
    await recordOutcome({
      organizationId: exec.organizationId, signature: sig, runbookKey: exec.runbookKey, outcome: "success",
    });
    emit("ticket:updated", { ticketId: exec.ticketId, refCode: exec.ticket.refCode, status: "RESOLVED" });
    emit("analytics:updated", { reason: "autopilot-verified" });
    n += 1;
  }
  return n;
}

// Make sure tools that need to import getRunbook see it.
void getRunbook;
