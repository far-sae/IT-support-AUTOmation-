/**
 * Runbook engine types.
 *
 * A Runbook is a small unit of automated work that can either resolve a
 * ticket outright (LOW risk) or take an action and wait for confirmation
 * (MEDIUM) or queue for a human agent's one-click approval (HIGH).
 *
 * Each runbook implements:
 *   • `match`    — given the ticket + triage, return a confidence score.
 *   • `execute`  — actually do the work; return what happened.
 *
 * Execution is wrapped by `runbooks/engine.ts` which writes the
 * RunbookExecution row, posts the audit comment, and (where applicable)
 * resolves the ticket.
 */

import type { Ticket } from "@prisma/client";
import type { TriageResult } from "../triage.js";

export type RunbookRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface RunbookMatch {
  /** 0–1. The engine ignores matches below 0.5. */
  confidence: number;
  /** Human-readable; appears in the internal note. */
  reason: string;
}

export interface RunbookContext {
  ticket: Ticket;
  triage: TriageResult;
}

export interface RunbookOutcome {
  /**
   * SUCCEEDED              — runbook fixed the issue, ticket will be closed (if `closeTicket`)
   * AWAITING_USER          — (legacy Phase 10A) autopilot promotes these to AWAITING_VERIFICATION
   * AWAITING_VERIFICATION  — Phase 10B/C: action dispatched, waiting for timer / agent result
   * AWAITING_AGENT         — HIGH risk; queued for an agent's one-click approval
   * FAILED                 — couldn't complete; ticket stays open
   */
  status: "SUCCEEDED" | "AWAITING_USER" | "AWAITING_VERIFICATION" | "AWAITING_AGENT" | "FAILED";
  /** Public comment to post on the ticket (markdown-ish; rendered as text). */
  publicComment: string;
  /** Optional internal-note comment for agents. */
  internalNote?: string;
  /** Whether to flip the ticket to RESOLVED. Ignored unless status=SUCCEEDED. */
  closeTicket?: boolean;
  /** Free-form record of what ran (stored on RunbookExecution.decision). */
  decision: Record<string, unknown>;
}

export interface Runbook {
  key: string;                // stable id, e.g. "password_reset"
  name: string;               // display name
  description: string;        // shown on the org settings panel
  risk: RunbookRiskLevel;
  match(ctx: RunbookContext): RunbookMatch;
  execute(ctx: RunbookContext): Promise<RunbookOutcome>;
}
