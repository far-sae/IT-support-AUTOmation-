/**
 * Phase 13 — Workflow type definitions.
 *
 * A `Workflow` is a named, in-code, multi-step plan that an executor walks
 * through against a specific ticket. Each `WorkflowStep` returns one of
 * three outcomes:
 *
 *   • COMPLETED — step done, executor advances to `nextStepKey` (or the
 *                 next-in-sequence step if unset)
 *   • WAITING   — step paused; pass `resumeAt` and the executor will try
 *                 again at that time
 *   • FAILED    — irrecoverable; executor walks completed steps in reverse
 *                 and invokes their `compensate()` if defined
 *
 * Steps are pure TS — no YAML, no JSON DSL. New workflows = new file in
 * builtins.ts + register in registry.ts.
 */

import type { Ticket } from "@prisma/client";

export type StepOutcome =
  | { status: "COMPLETED"; output?: Record<string, unknown>; nextStepKey?: string }
  | { status: "WAITING";   resumeAt: Date;                    output?: Record<string, unknown> }
  | { status: "FAILED";    errorReason: string;               output?: Record<string, unknown> };

/**
 * Free-form bag the executor passes through. `ticket` is the current row;
 * `context` is the accumulated output of previously-run steps keyed by
 * stepKey ({ "run_diagnostic": { diskFullPercent: 92, ... }, ... }).
 */
export interface StepContext {
  ticket: Ticket;
  organizationId: string;
  workflowExecutionId: string;
  context: Record<string, unknown>;
}

export interface WorkflowStep {
  key: string;
  name: string;
  /** Human-readable explainer surfaced in the timeline UI. */
  description: string;
  /** Drive a single step's logic. */
  execute: (ctx: StepContext) => Promise<StepOutcome>;
  /**
   * Optional inverse — runs when a LATER step in the same workflow fails
   * and the engine walks backward to unwind.
   */
  compensate?: (ctx: StepContext) => Promise<void>;
}

export interface Workflow {
  key: string;
  name: string;
  description: string;
  /** Ordered step list. The executor advances by sequence unless a step
   *  returns a `nextStepKey` to jump to a labelled later step. */
  steps: WorkflowStep[];
  /**
   * Match decides whether this workflow is even applicable to a given ticket.
   * Used by routes that auto-pick a workflow at ticket-creation time.
   * Return null when the workflow doesn't fit.
   */
  match?: (ticket: Ticket) => { confidence: number; reason: string } | null;
}

/** Convenience for engine bookkeeping. */
export interface NextStepResolution {
  nextSequence: number | null;  // null = no more steps
  nextStepKey: string | null;
}
