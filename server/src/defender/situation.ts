/**
 * Phase 26 — Build the situation report the defender agent reads at start.
 *
 * Reads:
 *   • last 24 h of ThreatIntel + ThreatMatch + DetectionHit for the org
 *   • current Device fleet snapshot (size + OS breakdown + health counts)
 *   • the previous defender run's decisions + observable outcomes
 *
 * Returns a small, JSON-friendly object — capped sizes everywhere so the
 * prompt never balloons.
 */

import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import type { DefenderSituation } from "./types.js";

const WINDOW_HOURS = 24;

export async function buildSituation(organizationId: string, runDate: Date): Promise<DefenderSituation> {
  const since = new Date(runDate.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  return runWithTenant(organizationId, async () => {
    // Fleet snapshot.
    const devices = await prisma.device.findMany({
      select: { os: true, healthStatus: true, lastCheckInAt: true },
    });
    const osBreakdown: Record<string, number> = {};
    let criticalDeviceCount = 0;
    let staleDeviceCount = 0;
    const staleCutoff = new Date(runDate.getTime() - 60 * 60 * 1000);
    for (const d of devices) {
      const osKey = (d.os ?? "unknown").split(/\s+/).slice(0, 2).join(" ");
      osBreakdown[osKey] = (osBreakdown[osKey] ?? 0) + 1;
      if (d.healthStatus === "CRITICAL") criticalDeviceCount++;
      if (d.lastCheckInAt && d.lastCheckInAt < staleCutoff) staleDeviceCount++;
    }

    // Threat-intel in the window. ThreatIntel is GLOBAL, not org-scoped, so
    // use basePrismaUnscoped.
    const newIntel = await basePrismaUnscoped.threatIntel.findMany({
      where: { ingestedAt: { gte: since } },
      orderBy: [{ severity: "desc" }, { publishedAt: "desc" }],
      take: 30,
    });
    const newKevCount      = newIntel.filter((t) => t.kind === "KEV").length;
    const newCveCount      = newIntel.filter((t) => t.kind === "CVE").length;
    const newAdvisoryCount = newIntel.filter((t) => t.kind === "ADVISORY").length;
    const newNewsCount     = newIntel.filter((t) => t.kind === "NEWS").length;

    const topItems = newIntel
      .filter((t) => t.severity === "CRITICAL" || t.severity === "HIGH")
      .slice(0, 8)
      .map((t) => ({
        id: t.id, externalId: t.externalId, kind: t.kind, severity: t.severity,
        title: t.title.slice(0, 140), source: t.source,
      }));

    // Threat matches in the window.
    const matches = await prisma.threatMatch.findMany({
      where: { createdAt: { gte: since }, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      include: { threatIntel: true }, take: 30,
    });
    const criticalMatchCount = matches.filter((m) => m.threatIntel.severity === "CRITICAL").length;
    const topMatches = matches.slice(0, 8).map((m) => ({
      id: m.id, cveId: m.threatIntel.externalId,
      severity: m.threatIntel.severity, reason: m.reason,
    }));

    // Detection hits in the window.
    const hits = await prisma.detectionHit.findMany({
      where: { createdAt: { gte: since } },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 20,
    });
    const topHits = hits.slice(0, 8).map((h) => ({
      id: h.id, ruleKey: h.ruleKey, severity: h.severity, count: h.count,
    }));

    // Previous run + its outcomes.
    const prev = await prisma.defenderRun.findFirst({
      where: { status: { in: ["SUCCEEDED", "HALTED"] } },
      orderBy: { runDate: "desc" }, take: 1,
    });
    let previousRun: DefenderSituation["previousRun"];
    if (prev) {
      const outcomes = (prev.outcomes ?? {}) as {
        ticketsOpened?: number; ticketsResolved?: number; dismissedThenRefired?: number;
      };
      previousRun = {
        runDate: prev.runDate.toISOString().slice(0, 10),
        decisionsMade: Array.isArray(prev.decisions) ? prev.decisions.length : 0,
        ticketsOpened:        outcomes.ticketsOpened ?? 0,
        ticketsResolved:      outcomes.ticketsResolved ?? 0,
        dismissedThenRefired: outcomes.dismissedThenRefired ?? 0,
      };
    }

    return {
      organizationId,
      runDate: runDate.toISOString().slice(0, 10),
      windowHours: WINDOW_HOURS,
      fleet: {
        deviceCount: devices.length,
        osBreakdown,
        criticalDeviceCount,
        staleDeviceCount,
      },
      threatIntel: {
        newKevCount, newCveCount, newAdvisoryCount, newNewsCount,
        topItems,
      },
      threatMatches: {
        openCount: matches.length,
        criticalCount: criticalMatchCount,
        topMatches,
      },
      detections: {
        newHitsCount: hits.length,
        topHits,
      },
      previousRun,
    };
  });
}
