/**
 * Phase 19 — Automation-health detection rules.
 *
 *   • agent_action_failure_rate   — Tier-2 actions failing at high rate
 *   • workflow_compensating_burst — multiple workflows simultaneously unwinding
 *   • patch_rollout_failure       — apply_pending_updates failing repeatedly
 */

import { alignWindowStart, type DetectionRule } from "./types.js";

export const agentActionFailureRate: DetectionRule = {
  key: "agent_action_failure_rate",
  name: "Agent actions failing at a high rate",
  description: "Of the agent actions completed in the last 30 min, ≥40% reported FAILED. Either the agent has a bug, the device fleet is unstable, or the actions themselves are pointed at the wrong systems.",
  severity: "MEDIUM",
  windowMinutes: 30,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 30);
    const windowEnd   = new Date(windowStart.getTime() + 30 * 60 * 1000);
    const groups = await prisma.agentAction.groupBy({
      by: ["status"],
      where: { completedAt: { gte: windowStart, lt: windowEnd } },
      _count: { _all: true },
    });
    if (groups.length === 0) return [];
    let total = 0, failed = 0;
    for (const g of groups) {
      total += g._count._all;
      if (g.status === "FAILED") failed += g._count._all;
    }
    if (total < 5) return [];
    const rate = failed / total;
    if (rate < 0.4) return [];
    return [{
      windowStart, windowEnd, count: failed,
      evidence: { totalCompleted: total, failed, failureRate: Number(rate.toFixed(2)) },
    }];
  },
};

export const workflowCompensatingBurst: DetectionRule = {
  key: "workflow_compensating_burst",
  name: "Multiple workflows actively compensating",
  description: "3+ workflow executions currently in COMPENSATING state. Means several multi-step plans failed mid-flight and are rolling back simultaneously — points at a shared dependency outage.",
  severity: "HIGH",
  windowMinutes: 15,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 15);
    const windowEnd   = new Date(windowStart.getTime() + 15 * 60 * 1000);
    const live = await prisma.workflowExecution.findMany({});
    const compensating = live.filter((w) => w.status === "COMPENSATING");
    if (compensating.length < 3) return [];
    const byKey: Record<string, number> = {};
    for (const w of compensating) byKey[w.workflowKey] = (byKey[w.workflowKey] ?? 0) + 1;
    return [{
      windowStart, windowEnd, count: compensating.length,
      evidence: { byWorkflowKey: byKey, executionIds: compensating.slice(0, 10).map((w) => w.id) },
    }];
  },
};

export const patchRolloutFailure: DetectionRule = {
  key: "patch_rollout_failure",
  name: "Patch rollout failing across the fleet",
  description: "5+ apply_pending_updates runbook attempts FAILED in the last 30 minutes. A bad patch is hitting devices and bouncing — pause the rollout and investigate before more devices try.",
  severity: "HIGH",
  windowMinutes: 30,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 30);
    const windowEnd   = new Date(windowStart.getTime() + 30 * 60 * 1000);
    const groups = await prisma.runbookExecution.groupBy({
      by: ["runbookKey"],
      where: {
        runbookKey: "apply_pending_updates",
        status: "FAILED",
        startedAt: { gte: windowStart, lt: windowEnd },
      },
      _count: { _all: true },
    });
    const hit = groups[0];
    if (!hit || hit._count._all < 5) return [];
    return [{
      windowStart, windowEnd, count: hit._count._all,
      evidence: { runbookKey: hit.runbookKey, failed: hit._count._all },
    }];
  },
};
