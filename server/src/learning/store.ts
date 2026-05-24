/**
 * Outcome learning store.
 *
 * Every time the autopilot finalizes a RunbookExecution (SUCCEEDED / FAILED /
 * CANCELLED / ESCALATED), we increment the matching `RemediationOutcome` row.
 * Rows are keyed by `(organizationId, signature, runbookKey)` so each tenant
 * builds its own private memory of what works for what kind of ticket.
 *
 * The signature is a deterministic fingerprint of the ticket text — its
 * triage category plus its tokenized, sorted, deduped keywords. Two
 * tickets that look alike share a signature even if the wording differs.
 *
 * The brain reads `recommend()` to pick a runbook for a new ticket:
 *   • If we have a strong history (>=3 attempts) at this signature, the
 *     success rate biases the choice (multiplier on the base confidence).
 *   • Epsilon-greedy: 10 % of the time the brain ignores history and lets
 *     a long-tail runbook run, so the org keeps exploring new options.
 */

import { prisma } from "../db.js";
import type { TriageResult } from "../triage.js";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","of","to","in","for","on","at","with","is","was","are","were","be",
  "i","me","my","we","our","you","your","he","she","it","they","them","this","that","these","those",
  "im","ive","cant","dont","doesnt","wont","cannot","please","help","thanks","thank","hi","hello",
  "have","has","had","get","got","gets","getting","make","made","makes","take","took","takes",
  "see","saw","seen","try","tried","trying","need","needs","needed","want","wants","wanted",
  "would","could","should","will","also","still","just","like","when","then","than","there","here",
]);

export function signatureOf(triage: TriageResult, description: string): string {
  const tokens = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const top = Array.from(new Set(tokens)).sort().slice(0, 8);
  return `${triage.category}|${top.join("-")}`;
}

export async function recordOutcome(args: {
  organizationId: string;
  signature: string;
  runbookKey: string;
  outcome: "success" | "failure" | "escalation";
}): Promise<void> {
  const { organizationId, signature, runbookKey, outcome } = args;
  const field = outcome === "success" ? "successes" : outcome === "failure" ? "failures" : "escalations";

  await prisma.remediationOutcome.upsert({
    where: { organizationId_signature_runbookKey: { organizationId, signature, runbookKey } },
    create: { organizationId, signature, runbookKey, [field]: 1 },
    update: { [field]: { increment: 1 } },
  });
}

export interface RunbookStats {
  runbookKey: string;
  successes: number;
  failures: number;
  escalations: number;
  /** successes / (successes + failures + escalations). 1.0 if no data yet. */
  successRate: number;
  /** Total attempts. */
  attempts: number;
}

export async function statsForSignature(
  organizationId: string,
  signature: string,
): Promise<Record<string, RunbookStats>> {
  const rows = await prisma.remediationOutcome.findMany({
    where: { signature },
  });
  const out: Record<string, RunbookStats> = {};
  for (const r of rows) {
    const attempts = r.successes + r.failures + r.escalations;
    out[r.runbookKey] = {
      runbookKey: r.runbookKey,
      successes: r.successes,
      failures: r.failures,
      escalations: r.escalations,
      successRate: attempts === 0 ? 1 : r.successes / attempts,
      attempts,
    };
  }
  return out;
}

/**
 * Apply the learning weight to a raw match confidence.
 *
 *   • If we have no history (< 3 attempts) → return raw.
 *   • Otherwise blend: 60 % raw + 40 % historical success rate.
 *   • 10 % of the time (epsilon-greedy) we still let the raw value through
 *     so the system keeps exploring under-tried runbooks.
 */
export function weightConfidence(
  rawConfidence: number,
  stats: RunbookStats | undefined,
): { weighted: number; reason: string } {
  if (!stats || stats.attempts < 3) {
    return { weighted: rawConfidence, reason: "no history" };
  }
  if (Math.random() < 0.1) {
    return { weighted: rawConfidence, reason: "epsilon-greedy exploration" };
  }
  const weighted = rawConfidence * 0.6 + stats.successRate * 0.4;
  return {
    weighted,
    reason: `learned: ${stats.successes}/${stats.attempts} succeeded (rate ${(stats.successRate * 100).toFixed(0)}%)`,
  };
}
