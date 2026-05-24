/**
 * Policy engine.
 *
 * `evaluatePolicies(ctx)` walks every enabled policy and returns:
 *   • the first DENY (with reason + whether to escalate vs hard-block), or
 *   • an ALLOW with the score and explanation summary attached.
 *
 * Per-org disable lives in `Organization.settings.disabledPolicies`.
 */

import type { Ticket } from "@prisma/client";
import { basePrismaUnscoped, prisma } from "../db.js";
import { parseOrgSettings } from "../tenant/settings.js";
import type { Runbook } from "../runbooks/types.js";
import { POLICIES } from "./registry.js";
import type { PolicyContext, PolicyVerdict } from "./types.js";
import { computeRisk, type RiskScore } from "./risk.js";
import { statsForSignature, signatureOf } from "../learning/store.js";
import { triage } from "../triage.js";
import { consultOpa, opaEnabled } from "./opa.js";

export interface PolicyDecision {
  verdict: PolicyVerdict;
  policyKey?: string;
  risk: RiskScore;
}

/**
 * Walk every enabled policy. First DENY wins (most-specific guard first
 * in the registry). On ALLOW, returns the risk score for storage on
 * the runbook execution.
 */
export async function evaluatePolicies(args: {
  ticket: Ticket;
  runbook: Runbook;
  organizationId: string;
}): Promise<PolicyDecision> {
  const { ticket, runbook, organizationId } = args;

  // Load org settings + recent count + history all in parallel.
  const [org, recentRunbookCount, learning] = await Promise.all([
    basePrismaUnscoped.organization.findUnique({
      where: { id: organizationId }, select: { settings: true },
    }),
    prisma.runbookExecution.count({
      where: {
        runbookKey: runbook.key,
        startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    }),
    statsForSignature(organizationId, signatureOf(triage(ticket.description), ticket.description)),
  ]);

  const settings = parseOrgSettings(org?.settings);
  const stats = learning[runbook.key];

  const risk = computeRisk({
    runbookKey: runbook.key,
    runbookRisk: runbook.risk,
    category: ticket.category,
    priority: ticket.priority,
    blastDevices: 1, // single-device per-ticket today; bumps when broadcast actions land
    failuresAtSignature: stats?.failures,
    successesAtSignature: stats?.successes,
  });

  const disabled = new Set(settings.disabledPolicies ?? []);
  const ctx: PolicyContext = { ticket, runbook, risk, settings, recentRunbookCount, now: new Date() };

  for (const p of POLICIES) {
    if (disabled.has(p.key)) continue;
    const v = p.evaluate(ctx);
    if (v.decision === "DENY") {
      return { verdict: v, policyKey: p.key, risk };
    }
  }
  // Phase 17 — OPA. Only consulted if all built-in policies ALLOWed (OPA
  // can ADD a denial, never override a built-in DENY).
  if (opaEnabled()) {
    const opa = await consultOpa(ctx);
    if (opa.decision === "DENY") {
      return { verdict: opa, policyKey: "opa", risk };
    }
  }
  return { verdict: { decision: "ALLOW" }, risk };
}
