/**
 * Phase 12 — Detection engine.
 *
 * Walks every non-disabled rule for every non-platform organization, calls
 * its `detect()` and persists hits via `prisma.detectionHit.upsert` keyed
 * on (org, ruleKey, windowStart) — so the same burst doesn't pile up.
 *
 * Each NEW hit (created by upsert.create, not update) is mirrored onto the
 * event bus → Slack/email/ES.
 */

import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { bus } from "../events/bus.js";
import { DETECTION_RULES } from "./registry.js";
import type { DetectionPrisma, DetectionRule } from "./types.js";

export interface RunDetectionsResult {
  organizationsScanned: number;
  rulesEvaluated: number;
  hitsCreated: number;
}

/**
 * Run all detection rules against the supplied org. Exposed for testing /
 * one-off invocation from a route.
 */
export async function runDetectionsForOrg(
  organizationId: string,
  now: Date = new Date(),
): Promise<number> {
  const org = await basePrismaUnscoped.organization.findUnique({
    where: { id: organizationId }, select: { settings: true },
  });
  const settings = parseOrgSettings(org?.settings);
  const disabled = new Set(settings.disabledDetectionRules ?? []);

  let hitsCreated = 0;

  await runWithTenant(organizationId, async () => {
    for (const rule of DETECTION_RULES) {
      if (disabled.has(rule.key)) continue;
      try {
        const matches = await rule.detect({
          organizationId,
          prisma: prisma as unknown as DetectionPrisma,
          now,
        });
        for (const m of matches) {
          const wasNew = await persistHit(organizationId, rule, m);
          if (wasNew) hitsCreated++;
        }
      } catch (err) {
        console.error(`[detect] rule '${rule.key}' threw:`, err);
      }
    }
  });

  return hitsCreated;
}

/**
 * Run all detection rules against every non-platform organization.
 * Used by the cron.
 */
export async function runDetectionsForAllOrgs(now: Date = new Date()): Promise<RunDetectionsResult> {
  const orgs = await basePrismaUnscoped.organization.findMany({
    where: { slug: { not: "platform" }, suspendedAt: null },
    select: { id: true },
  });
  let hitsCreated = 0;
  for (const o of orgs) {
    hitsCreated += await runDetectionsForOrg(o.id, now);
  }
  return {
    organizationsScanned: orgs.length,
    rulesEvaluated: orgs.length * DETECTION_RULES.length,
    hitsCreated,
  };
}

/**
 * Idempotent — returns true when this call actually created a new row
 * (so the caller can fire a notification only on novel hits).
 */
async function persistHit(
  organizationId: string,
  rule: DetectionRule,
  m: { windowStart: Date; windowEnd: Date; count: number; evidence: Record<string, unknown> },
): Promise<boolean> {
  // We need to know whether upsert.create ran. Easiest path: check existence
  // first. The (org, ruleKey, windowStart) unique guarantees the race is
  // safe — second writer just updates the count.
  const existing = await prisma.detectionHit.findUnique({
    where: {
      organizationId_ruleKey_windowStart: {
        organizationId, ruleKey: rule.key, windowStart: m.windowStart,
      },
    },
    select: { id: true },
  });

  await prisma.detectionHit.upsert({
    where: {
      organizationId_ruleKey_windowStart: {
        organizationId, ruleKey: rule.key, windowStart: m.windowStart,
      },
    },
    create: {
      organizationId, ruleKey: rule.key, severity: rule.severity,
      count: m.count, windowStart: m.windowStart, windowEnd: m.windowEnd,
      evidence: m.evidence as object,
    },
    update: { count: m.count, evidence: m.evidence as object },
  });

  if (!existing) {
    bus.emit({
      kind: "detection.hit",
      organizationId,
      ruleKey: rule.key,
      severity: rule.severity,
      count: m.count,
      evidence: m.evidence,
    });
    return true;
  }
  return false;
}
