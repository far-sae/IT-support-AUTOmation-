/**
 * Transparent 0–100 risk score for tickets + proposed actions.
 *
 * The brain attaches the score to every RunbookExecution so the timeline
 * and the daily brief can show "this fired with risk 22" rather than
 * a magic number. Policies key off the score: e.g. risk ≥ 60 needs
 * admin approval.
 *
 * The formula is deliberately simple and explainable:
 *
 *   base       depends on the runbook (read-only diagnostics ≈ 5,
 *              service restart ≈ 30, OS patch ≈ 55, github_dispatch ≈ 65)
 *   priority   Critical +20, High +10, Medium +0, Low −5
 *   category   Security +15, Account & Access +10, Network +5, else 0
 *   blast      affected_devices > 1: +5 per device, capped at +25
 *   history    if this (signature × runbook) failed before:
 *              +15 per failure (capped at +30); if it succeeded ≥ 3 times: −10
 *
 * Capped at [0, 100].
 */

import type { RunbookRiskLevel } from "../runbooks/types.js";

const RUNBOOK_BASE: Record<string, number> = {
  // Tier 1
  kb_deflection:     5,
  password_reset:    20,
  mfa_reset:         25,
  account_unlock:    20,
  license_assign:    15,
  software_install:  25,
  // Tier 2
  run_diagnostic:    5,
  clear_cache:       20,
  disk_cleanup:      30,
  restart_service:   30,
  apply_pending_updates: 55,
  // Phase 11
  github_dispatch:   65,
  // Phase 14 — infrastructure actions. All HIGH-risk territory.
  terraform_apply:   70,
  ansible_playbook:  60,
  firewall_block_ip: 55,
  // ITSM is just an outbound push — read+write but no infrastructure
  // change, so much lower.
  itsm_sync:         15,
};

export interface RiskInputs {
  runbookKey?: string;
  runbookRisk?: RunbookRiskLevel;
  category: string;
  priority: string;            // "Critical" | "High" | "Medium" | "Low"
  blastDevices?: number;
  failuresAtSignature?: number;
  successesAtSignature?: number;
}

export interface RiskScore {
  score: number;               // 0–100
  /** Human-readable contributions for the audit log + UI. */
  reasons: string[];
}

export function computeRisk(inp: RiskInputs): RiskScore {
  const reasons: string[] = [];
  let score = 0;

  if (inp.runbookKey) {
    const base = RUNBOOK_BASE[inp.runbookKey] ?? (inp.runbookRisk === "HIGH" ? 60 : inp.runbookRisk === "MEDIUM" ? 30 : 10);
    score += base;
    reasons.push(`runbook:${inp.runbookKey} base ${base}`);
  } else if (inp.runbookRisk) {
    const base = inp.runbookRisk === "HIGH" ? 60 : inp.runbookRisk === "MEDIUM" ? 30 : 10;
    score += base;
    reasons.push(`risk-level:${inp.runbookRisk} base ${base}`);
  }

  switch (inp.priority) {
    case "Critical": score += 20; reasons.push("priority:Critical +20"); break;
    case "High":     score += 10; reasons.push("priority:High +10"); break;
    case "Low":      score -= 5;  reasons.push("priority:Low −5"); break;
    default:         reasons.push("priority:Medium +0");
  }

  if (inp.category === "Security")        { score += 15; reasons.push("category:Security +15"); }
  else if (inp.category === "Account & Access") { score += 10; reasons.push("category:Account & Access +10"); }
  else if (inp.category === "Network")    { score += 5;  reasons.push("category:Network +5"); }

  if (inp.blastDevices && inp.blastDevices > 1) {
    const bump = Math.min(25, (inp.blastDevices - 1) * 5);
    score += bump;
    reasons.push(`blast:${inp.blastDevices} devices +${bump}`);
  }

  if (inp.failuresAtSignature && inp.failuresAtSignature > 0) {
    const bump = Math.min(30, inp.failuresAtSignature * 15);
    score += bump;
    reasons.push(`history: ${inp.failuresAtSignature} past failures +${bump}`);
  } else if (inp.successesAtSignature && inp.successesAtSignature >= 3) {
    score -= 10;
    reasons.push(`history: ${inp.successesAtSignature} past successes −10`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

export function riskBucket(score: number): "low" | "moderate" | "elevated" | "high" {
  if (score < 20) return "low";
  if (score < 40) return "moderate";
  if (score < 70) return "elevated";
  return "high";
}
