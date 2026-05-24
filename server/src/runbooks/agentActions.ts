/**
 * Phase 10C — helpers shared by every Tier 2 (agent-driven) runbook.
 *
 * `dispatchAgentAction` — locates the right device, queues an AgentAction
 * row linked to the runbook execution, and updates the execution into
 * AWAITING_VERIFICATION with a long verifyAt fallback (in case the agent
 * never reports back).
 *
 * `settleFromAgentResult` — called by the result-callback endpoint. Looks
 * up the linked execution, marks it SUCCEEDED or FAILED, closes/reopens
 * the ticket accordingly, fires the survey on success.
 */

import { RunbookStatus, TicketStatus, type AgentActionKind } from "@prisma/client";
import { basePrismaUnscoped, prisma } from "../db.js";
import { emit } from "../realtime/socket.js";
import { runWithTenant } from "../tenant/context.js";
import { recordOutcome, signatureOf } from "../learning/store.js";
import { triage } from "../triage.js";

/**
 * Find the device for the ticket's submitter.
 *   • First: exact (case-insensitive) match on Device.assignedUser
 *   • Fallback: most-recently-checked-in agent-managed device in the org
 */
export async function findTicketDevice(args: {
  organizationId: string;
  submitterName: string;
}): Promise<{ id: string; hostname: string } | null> {
  const exact = await prisma.device.findFirst({
    where: { assignedUser: { equals: args.submitterName, mode: "insensitive" } },
    select: { id: true, hostname: true },
  });
  if (exact) return exact;

  return prisma.device.findFirst({
    where: { discoverySource: "AGENT", lastCheckInAt: { not: null } },
    orderBy: { lastCheckInAt: "desc" },
    select: { id: true, hostname: true },
  });
}

export interface DispatchResult {
  actionId: string;
  deviceHostname: string;
}

/**
 * Queue an AgentAction. Called from inside a Tier 2 runbook's execute().
 * Returns the created action's id + the hostname for narration.
 */
export async function dispatchAgentAction(args: {
  organizationId: string;
  deviceId: string;
  deviceHostname: string;
  kind: AgentActionKind;
  input: Record<string, unknown>;
  runbookExecutionId?: string;
}): Promise<DispatchResult> {
  const action = await prisma.agentAction.create({
    data: {
      organizationId: args.organizationId,
      deviceId: args.deviceId,
      kind: args.kind,
      input: args.input as object,
      runbookExecutionId: args.runbookExecutionId,
    },
  });
  return { actionId: action.id, deviceHostname: args.deviceHostname };
}

/**
 * Called by the agent's result POST. The runbook engine left the execution
 * in AWAITING_VERIFICATION with a fallback verifyAt; this short-circuits it
 * the moment we hear back from the device.
 */
export async function settleFromAgentResult(
  executionId: string,
  organizationId: string,
  ok: boolean,
  output: string | undefined,
): Promise<void> {
  await runWithTenant(organizationId, async () => {
    const exec = await prisma.runbookExecution.findUnique({
      where: { id: executionId },
      include: { ticket: true },
    });
    if (!exec) return;
    if (exec.status === RunbookStatus.SUCCEEDED || exec.status === RunbookStatus.FAILED) return;

    const now = new Date();
    const sig = signatureOf(triage(exec.ticket.description), exec.ticket.description);

    if (ok) {
      await prisma.runbookExecution.update({
        where: { id: executionId },
        data: { status: RunbookStatus.SUCCEEDED, completedAt: now },
      });
      // Append the agent's output to the brain log.
      if (output) {
        const prev = Array.isArray(exec.brainLog) ? (exec.brainLog as unknown as object[]) : [];
        await prisma.runbookExecution.update({
          where: { id: executionId },
          data: {
            brainLog: [...prev, {
              at: now.toISOString(), role: "tool",
              text: `agent reported success: ${output.slice(0, 600)}`,
            }] as unknown as object,
          },
        });
      }
      // Resolve the ticket + survey.
      if (exec.ticket.status !== TicketStatus.RESOLVED) {
        await prisma.ticket.update({
          where: { id: exec.ticketId },
          data: { status: TicketStatus.RESOLVED, resolvedAt: now },
        });
        try {
          const { createSurveyForTicket } = await import("../survey/survey.js");
          await createSurveyForTicket(exec.ticketId);
        } catch (err) {
          console.error("[agent-actions] survey send failed:", err);
        }
        try {
          const { indexResolvedTicket } = await import("../memory/store.js");
          await indexResolvedTicket(exec.ticketId);
        } catch (err) {
          console.error("[agent-actions] memory index failed:", err);
        }
      }
      await recordOutcome({
        organizationId, signature: sig, runbookKey: exec.runbookKey, outcome: "success",
      });
      emit("ticket:updated", { ticketId: exec.ticketId, refCode: exec.ticket.refCode, status: "RESOLVED" });
      emit("analytics:updated", { reason: "agent-action-succeeded" });
      return;
    }

    // Failure path — settle as FAILED, rollback any reversible siblings, and
    // let the brain re-try.
    await prisma.runbookExecution.update({
      where: { id: executionId },
      data: { status: RunbookStatus.FAILED, completedAt: now },
    });
    // Phase 11 — automatic rollback for reversible actions.
    let rolledBack = 0;
    try {
      const { dispatchRollbackFor } = await import("./rollback.js");
      rolledBack = await dispatchRollbackFor(executionId);
    } catch (err) {
      console.error("[agent-actions] rollback dispatch failed:", err);
    }
    await prisma.comment.create({
      data: {
        organizationId, ticketId: exec.ticketId,
        authorId: (await fallbackAuthor(organizationId)) ?? exec.ticket.submitterUserId ?? "",
        body: `[Autopilot] Agent reported the action failed${output ? `:\n\n${output.slice(0, 400)}` : "."}` +
              (rolledBack > 0 ? `\n\nQueued ${rolledBack} rollback action(s) on the device.` : "") +
              `\n\nRe-attempting with a different strategy.`,
        isInternal: false,
      },
    });
    await recordOutcome({
      organizationId, signature: sig, runbookKey: exec.runbookKey, outcome: "failure",
    });
    emit("ticket:updated", { ticketId: exec.ticketId, refCode: exec.ticket.refCode, status: exec.ticket.status });

    // Re-trigger the brain on this ticket — with the failure in its learning row,
    // a different runbook should be picked.
    try {
      const { decideAndExecute } = await import("../brain/index.js");
      await decideAndExecute(exec.ticket, triage(exec.ticket.description));
    } catch (err) {
      console.error("[agent-actions] re-trigger failed:", err);
    }
  });
}

async function fallbackAuthor(organizationId: string): Promise<string | null> {
  const u = await basePrismaUnscoped.user.findFirst({
    where: { organizationId, role: "ADMIN" },
    orderBy: { createdAt: "asc" }, select: { id: true },
  });
  return u?.id ?? null;
}
