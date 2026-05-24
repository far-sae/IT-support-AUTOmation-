/**
 * Policy engine — guard-rails consulted before the runbook engine executes.
 *
 * Each policy is a plain object with:
 *   • key, name, description — for the org settings page + audit log
 *   • evaluate(ctx)         — synchronous; returns ALLOW or DENY w/ reason.
 *
 * A DENY can optionally request escalation: the runbook is put on hold
 * with status AWAITING_AGENT instead of being silently blocked.
 */

import type { Ticket } from "@prisma/client";
import type { Runbook } from "../runbooks/types.js";
import type { OrgSettings } from "../tenant/settings.js";
import type { RiskScore } from "./risk.js";

export interface PolicyContext {
  ticket: Ticket;
  runbook: Runbook;
  risk: RiskScore;
  /** Per-org settings (so policies can read businessHours, etc.). */
  settings: OrgSettings;
  /** Number of similar-tenant actions in the last hour (for blast-radius checks). */
  recentRunbookCount: number;
  /** Pass-through clock for tests. */
  now: Date;
}

export type PolicyVerdict =
  | { decision: "ALLOW"; reason?: string }
  | { decision: "DENY"; reason: string; escalate?: boolean };

export interface Policy {
  key: string;
  name: string;
  description: string;
  evaluate(ctx: PolicyContext): PolicyVerdict;
}
