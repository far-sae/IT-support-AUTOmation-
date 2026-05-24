/**
 * Phase 27 — Historical rule replay.
 *
 * Given a candidate rule spec + an org, replay it against the last 30 days
 * of SensorAlert rows. Returns an estimate of how often the rule would
 * have fired and the rough false-positive rate (proxied by # fires per
 * alert matched — a rule that fires on every alert it sees is likely
 * noisy).
 *
 * Used by:
 *   • The AI study session to test rules before submitting for review
 *   • The rules UI to show "what would have happened" before approval
 */

import { prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { evaluateRule, type RuleSpec } from "./dsl.js";

export interface ReplayReport {
  samplesEvaluated: number;
  matchingAlerts:   number;
  /** How many times the rule would have fired across the 30-day window. */
  totalFires:       number;
  /** Rough false-positive proxy: 1 - (matchingAlerts / totalFires accumulated alertIds). */
  signalStrength:   number;
  /** Top groups that triggered (for the UI). */
  topGroups: Array<{ group: string; count: number }>;
}

const LOOKBACK_DAYS = 30;

export async function replayRule(organizationId: string, spec: RuleSpec): Promise<ReplayReport> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  return runWithTenant(organizationId, async () => {
    // Load all alerts in the window. Cap to 10k for cost.
    const alerts = await prisma.sensorAlert.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 10_000,
      select: {
        source: true, sourceRuleId: true, level: true, description: true,
        mitreTechniqueId: true, agentName: true, srcIp: true, dstIp: true,
        createdAt: true,
      },
    });

    // For replay we slide the window across each alert's timestamp, since
    // a single rule fires once per (group, window). To keep this simple
    // we re-evaluate every minute step using the same algorithm — but for
    // perf we bound by sampling at most 1000 windows.
    const sampleStep = Math.max(60_000, Math.floor((alerts.length / 1000) || 60_000));
    let totalFires = 0;
    let matchingAlerts = 0;
    const groupCounts = new Map<string, number>();

    if (alerts.length > 0) {
      const first = alerts[0]!.createdAt.getTime();
      const last  = alerts[alerts.length - 1]!.createdAt.getTime();
      for (let t = first; t <= last; t += sampleStep) {
        const now = new Date(t);
        const fires = evaluateRule(spec, alerts, now);
        for (const f of fires) {
          totalFires++;
          matchingAlerts += f.count;
          groupCounts.set(f.group, (groupCounts.get(f.group) ?? 0) + 1);
        }
      }
    }

    const signalStrength =
      totalFires === 0 ? 0 :
      Math.max(0, Math.min(1, matchingAlerts / (totalFires * spec.threshold.count)));

    const topGroups = [...groupCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([group, count]) => ({ group, count }));

    return {
      samplesEvaluated: alerts.length,
      matchingAlerts,
      totalFires,
      signalStrength,
      topGroups,
    };
  });
}
