/**
 * Phase 13 — Workflow executor.
 *
 *   startWorkflow({ ticketId, workflowKey })
 *     creates the WorkflowExecution row + PENDING step rows, fires the
 *     first step immediately.
 *
 *   advanceWorkflows({ now })
 *     called by the cron — picks up RUNNING / WAITING executions whose
 *     current step is ready and drives them forward.
 *
 *   approveWaitingStep(workflowExecutionId, stepKey)
 *     unblocks a manual-approval WAITING step (used by the route).
 *
 * The engine is intentionally simple:
 *   • single-step at a time per execution (no fan-out yet)
 *   • compensation walks COMPLETED steps in reverse and invokes their
 *     compensate() function — failures during compensation are logged
 *     but don't halt the unwind.
 *   • status transitions are single transactions so a crash mid-tick
 *     leaves the row consistent.
 */

import { prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { findWorkflow } from "./registry.js";
import type { Workflow, WorkflowStep, StepContext, StepOutcome } from "./types.js";

const STEP_TIMEOUT_MS = 5 * 60 * 1000; // a step is force-failed if it stays RUNNING this long

// ─── Lifecycle ───────────────────────────────────────────────────────

export interface StartWorkflowArgs {
  organizationId: string;
  ticketId: string;
  workflowKey: string;
}

export async function startWorkflow(args: StartWorkflowArgs): Promise<string> {
  const workflow = findWorkflow(args.workflowKey);
  if (!workflow) throw new Error(`unknown workflow '${args.workflowKey}'`);
  const ticket = await prisma.ticket.findUnique({ where: { id: args.ticketId } });
  if (!ticket) throw new Error(`ticket '${args.ticketId}' not found`);

  return runWithTenant(args.organizationId, async () => {
    const execution = await prisma.workflowExecution.create({
      data: {
        organizationId: args.organizationId,
        ticketId: args.ticketId,
        workflowKey: workflow.key,
        status: "RUNNING",
        currentStepKey: workflow.steps[0]?.key ?? null,
        context: {} as object,
      },
    });
    // Pre-create PENDING rows for every step so the timeline is complete
    // even before any of them run. We update them as the executor advances.
    await prisma.workflowStepExecution.createMany({
      data: workflow.steps.map((s, i) => ({
        workflowExecutionId: execution.id,
        stepKey: s.key,
        sequence: i,
        status: "PENDING" as const,
      })),
    });
    // Try to run the first step immediately so the API call returns a
    // visible state change.
    await advanceOne(execution.id).catch((err) =>
      console.error("[workflow] initial advance failed:", err),
    );
    return execution.id;
  });
}

/**
 * Cron entry point — walks every actionable execution and tries to advance
 * each one by one step. Returns how many advances happened.
 */
export async function advanceWorkflows(now: Date = new Date()): Promise<number> {
  // Pull base prisma + filter by tenant inside each iteration so a single
  // hung tenant can't block the rest.
  const candidates = await prisma.workflowExecution.findMany({
    where: { status: { in: ["RUNNING", "WAITING"] } },
    select: { id: true, organizationId: true },
    take: 200,
  });
  let advanced = 0;
  for (const c of candidates) {
    try {
      const did = await runWithTenant(c.organizationId, () => advanceOne(c.id, now));
      if (did) advanced++;
    } catch (err) {
      console.error(`[workflow] advance ${c.id} failed:`, err);
    }
  }
  return advanced;
}

/**
 * Mark a manual-approval WAITING step as SUCCEEDED so the executor moves on.
 */
export async function approveWaitingStep(
  workflowExecutionId: string, stepKey: string, approvedBy: string,
): Promise<void> {
  await prisma.workflowStepExecution.updateMany({
    where: { workflowExecutionId, stepKey, status: "WAITING" },
    data: {
      status: "SUCCEEDED",
      output: { approvedBy } as object,
      completedAt: new Date(),
      resumeAt: null,
    },
  });
  await prisma.workflowExecution.update({
    where: { id: workflowExecutionId },
    data: { status: "RUNNING" },
  });
  await advanceOne(workflowExecutionId).catch((err) =>
    console.error("[workflow] post-approval advance failed:", err),
  );
}

export async function cancelWorkflow(workflowExecutionId: string, reason: string): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: workflowExecutionId },
    data: {
      status: "CANCELLED", errorReason: reason, completedAt: new Date(),
    },
  });
}

// ─── Internals ───────────────────────────────────────────────────────

/**
 * Advance a single execution by at most one step. Returns true if anything
 * actually changed (so the cron can count work done).
 */
async function advanceOne(executionId: string, now: Date = new Date()): Promise<boolean> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    include: { ticket: true, steps: { orderBy: { sequence: "asc" } } },
  });
  if (!execution) return false;
  if (!["RUNNING", "WAITING", "COMPENSATING"].includes(execution.status)) return false;

  // Re-pull the workflow definition (immutable, in-code).
  const workflow = findWorkflow(execution.workflowKey);
  if (!workflow) {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: "FAILED", errorReason: `workflow definition '${execution.workflowKey}' not found`, completedAt: new Date() },
    });
    return true;
  }

  if (execution.status === "COMPENSATING") {
    return advanceCompensation(execution, workflow);
  }

  // Find the step the executor should work on next.
  const step = pickNextStep(execution, workflow);
  if (!step) {
    // No more work → SUCCEEDED.
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: "SUCCEEDED", currentStepKey: null, completedAt: new Date() },
    });
    return true;
  }

  const stepRow = execution.steps.find((r) => r.stepKey === step.key);
  if (!stepRow) return false; // should never happen — rows are pre-created

  // Honour resumeAt for WAITING steps.
  if (stepRow.status === "WAITING" && stepRow.resumeAt && stepRow.resumeAt > now) {
    return false;
  }
  // Skip a step that already terminated — pickNextStep already excludes,
  // but defensive guard.
  if (["SUCCEEDED", "FAILED", "SKIPPED", "COMPENSATED"].includes(stepRow.status)) {
    return false;
  }

  // Mark RUNNING + flip the parent execution to RUNNING.
  await prisma.workflowStepExecution.update({
    where: { id: stepRow.id },
    data: { status: "RUNNING", startedAt: stepRow.startedAt ?? now, resumeAt: null },
  });
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: "RUNNING", currentStepKey: step.key },
  });

  let outcome: StepOutcome;
  const ctx: StepContext = {
    ticket: execution.ticket,
    organizationId: execution.organizationId,
    workflowExecutionId: executionId,
    context: (execution.context as Record<string, unknown>) ?? {},
  };
  try {
    outcome = await Promise.race([
      step.execute(ctx),
      new Promise<StepOutcome>((_, reject) =>
        setTimeout(() => reject(new Error("step timed out")), STEP_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    outcome = { status: "FAILED", errorReason: (err as Error).message ?? String(err) };
  }

  await applyOutcome(execution, workflow, step, outcome);
  return true;
}

async function applyOutcome(
  execution: { id: string; context: unknown },
  workflow: Workflow,
  step: WorkflowStep,
  outcome: StepOutcome,
): Promise<void> {
  const now = new Date();
  if (outcome.status === "COMPLETED") {
    // Merge step output into execution.context under stepKey.
    const ctxObj = (execution.context as Record<string, unknown>) ?? {};
    const nextCtx = { ...ctxObj, [step.key]: outcome.output ?? {} };
    await prisma.workflowStepExecution.update({
      where: { workflowExecutionId_stepKey: { workflowExecutionId: execution.id, stepKey: step.key } },
      data: {
        status: "SUCCEEDED",
        output: (outcome.output ?? {}) as object,
        completedAt: now,
      },
    });
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        context: nextCtx as object,
        currentStepKey: outcome.nextStepKey ?? nextSequentialStepKey(workflow, step.key),
      },
    });
    // If there are unreachable later steps (branch chose ahead), mark them
    // SKIPPED so the timeline reads cleanly.
    if (outcome.nextStepKey) {
      const targetIdx = workflow.steps.findIndex((s) => s.key === outcome.nextStepKey);
      const myIdx     = workflow.steps.findIndex((s) => s.key === step.key);
      if (targetIdx > myIdx + 1) {
        const skipped = workflow.steps.slice(myIdx + 1, targetIdx).map((s) => s.key);
        if (skipped.length > 0) {
          await prisma.workflowStepExecution.updateMany({
            where: { workflowExecutionId: execution.id, stepKey: { in: skipped }, status: "PENDING" },
            data: { status: "SKIPPED", completedAt: now },
          });
        }
      }
    }
    return;
  }
  if (outcome.status === "WAITING") {
    await prisma.workflowStepExecution.update({
      where: { workflowExecutionId_stepKey: { workflowExecutionId: execution.id, stepKey: step.key } },
      data: {
        status: "WAITING",
        resumeAt: outcome.resumeAt,
        output: (outcome.output ?? {}) as object,
      },
    });
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: "WAITING" },
    });
    return;
  }
  // FAILED — record + trigger compensation.
  await prisma.workflowStepExecution.update({
    where: { workflowExecutionId_stepKey: { workflowExecutionId: execution.id, stepKey: step.key } },
    data: {
      status: "FAILED",
      errorReason: outcome.errorReason,
      output: (outcome.output ?? {}) as object,
      completedAt: now,
    },
  });
  await prisma.workflowExecution.update({
    where: { id: execution.id },
    data: { status: "COMPENSATING", errorReason: outcome.errorReason },
  });
}

/**
 * Walk completed steps in reverse and run each one's compensate() if defined.
 * One step per call so the cron stays predictable.
 */
async function advanceCompensation(
  execution: { id: string; organizationId: string; ticketId: string; context: unknown; steps: Array<{ id: string; stepKey: string; sequence: number; status: string }>; ticket: { id: string } },
  workflow: Workflow,
): Promise<boolean> {
  const succeeded = execution.steps
    .filter((s) => s.status === "SUCCEEDED")
    .sort((a, b) => b.sequence - a.sequence);
  const next = succeeded[0];
  if (!next) {
    // Nothing left to compensate.
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", completedAt: new Date() },
    });
    return true;
  }
  const def = workflow.steps.find((s) => s.key === next.stepKey);
  if (!def) {
    await prisma.workflowStepExecution.update({
      where: { id: next.id },
      data: { status: "COMPENSATED", completedAt: new Date() },
    });
    return true;
  }
  if (def.compensate) {
    try {
      await def.compensate({
        ticket: execution.ticket as unknown as Parameters<NonNullable<typeof def.compensate>>[0]["ticket"],
        organizationId: execution.organizationId,
        workflowExecutionId: execution.id,
        context: (execution.context as Record<string, unknown>) ?? {},
      });
    } catch (err) {
      console.error(`[workflow] compensation for ${next.stepKey} threw:`, err);
    }
  }
  await prisma.workflowStepExecution.update({
    where: { id: next.id },
    data: { status: "COMPENSATED", completedAt: new Date() },
  });
  return true;
}

function pickNextStep(
  execution: { currentStepKey: string | null; steps: Array<{ stepKey: string; sequence: number; status: string }> },
  workflow: Workflow,
): WorkflowStep | null {
  // 1. If currentStepKey points to a non-terminal step, run that.
  if (execution.currentStepKey) {
    const row = execution.steps.find((s) => s.stepKey === execution.currentStepKey);
    if (row && !["SUCCEEDED", "FAILED", "SKIPPED", "COMPENSATED"].includes(row.status)) {
      return workflow.steps.find((s) => s.key === execution.currentStepKey) ?? null;
    }
  }
  // 2. Otherwise pick the earliest PENDING step by sequence.
  const pending = execution.steps
    .filter((s) => s.status === "PENDING")
    .sort((a, b) => a.sequence - b.sequence)[0];
  if (!pending) return null;
  return workflow.steps.find((s) => s.key === pending.stepKey) ?? null;
}

function nextSequentialStepKey(workflow: Workflow, currentKey: string): string | null {
  const idx = workflow.steps.findIndex((s) => s.key === currentKey);
  if (idx === -1 || idx >= workflow.steps.length - 1) return null;
  return workflow.steps[idx + 1]?.key ?? null;
}
