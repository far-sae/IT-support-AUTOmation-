/**
 * Phase 16 — Feature extraction for the remediation classifier.
 *
 * Turns a (ticket, runbook, prior-history) triplet into a fixed-length
 * numeric vector. The same function is used at train time AND inference
 * time — feature order is locked by FEATURE_NAMES so a model trained
 * yesterday still aligns with today's vector.
 *
 * If you add a new feature: append it to FEATURE_NAMES (never reorder).
 * Old models with shorter vectors will still load — `predict()` validates
 * the dimension and the brain falls back to the heuristic on mismatch.
 */

import type { Ticket } from "@prisma/client";
import type { RunbookRiskLevel } from "../runbooks/types.js";

const PRIORITIES   = ["Critical", "High", "Medium", "Low"] as const;
const CATEGORIES   = ["Software", "Hardware", "Account & Access", "Network", "Security", "Other"] as const;

export const FEATURE_NAMES = [
  // Priority one-hot (4)
  "priority_critical",
  "priority_high",
  "priority_medium",
  "priority_low",
  // Category one-hot (6)
  "category_software",
  "category_hardware",
  "category_account",
  "category_network",
  "category_security",
  "category_other",
  // Runbook risk (1=LOW, 2=MEDIUM, 3=HIGH) normalised
  "runbook_risk_norm",
  // Smoothed historical success rate (Beta(1,1) prior)
  "history_success_rate",
  // log(1 + attempts) — recency proxy + confidence in the rate
  "history_log_attempts",
  // Business hours indicator (1 if 09:00–18:00 UTC Mon–Fri, else 0)
  "is_business_hours",
  // Raw match confidence from the runbook's matcher
  "match_confidence",
] as const;

export type FeatureName = typeof FEATURE_NAMES[number];

export interface FeatureInputs {
  ticket: Pick<Ticket, "priority" | "category" | "createdAt">;
  runbook: { risk: RunbookRiskLevel };
  matchConfidence: number;
  history: { successes: number; failures: number };
  now?: Date;
}

export function extractFeatures(inp: FeatureInputs): number[] {
  const v: number[] = new Array(FEATURE_NAMES.length).fill(0);
  let i = 0;

  // Priority one-hot
  for (const p of PRIORITIES) v[i++] = inp.ticket.priority === p ? 1 : 0;
  // Category one-hot (fallback to "Other" bucket when unrecognized)
  const cat = (CATEGORIES as readonly string[]).includes(inp.ticket.category)
    ? inp.ticket.category : "Other";
  for (const c of CATEGORIES) v[i++] = cat === c ? 1 : 0;
  // Runbook risk normalised to [0..1]
  v[i++] = inp.runbook.risk === "HIGH" ? 1 : inp.runbook.risk === "MEDIUM" ? 0.5 : 0;
  // Smoothed success rate: (succ + 1) / (succ + fail + 2)
  v[i++] = (inp.history.successes + 1) / (inp.history.successes + inp.history.failures + 2);
  // log-attempts
  v[i++] = Math.log1p(inp.history.successes + inp.history.failures);
  // Business hours
  const now = inp.now ?? new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  v[i++] = day >= 1 && day <= 5 && hour >= 9 && hour < 18 ? 1 : 0;
  // Match confidence (clamped)
  v[i++] = Math.max(0, Math.min(1, inp.matchConfidence));

  if (i !== FEATURE_NAMES.length) {
    throw new Error(`feature extraction off by ${FEATURE_NAMES.length - i}`);
  }
  return v;
}
