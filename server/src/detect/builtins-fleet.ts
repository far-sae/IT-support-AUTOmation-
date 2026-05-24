/**
 * Phase 19 — Fleet-health detection rules.
 *
 *   • outdated_agent_fleet  — many devices on stale agent versions
 *   • stale_device_burst    — many devices have stopped checking in
 *   • disk_full_burst       — many tickets / runbook attempts about disk usage
 */

import { alignWindowStart, type DetectionRule } from "./types.js";

export const outdatedAgentFleet: DetectionRule = {
  key: "outdated_agent_fleet",
  name: "Many devices on outdated agent versions",
  description: "5+ devices still report an `agentVersion` older than the freshest seen across the fleet. Indicates patch rollout is stalled or some devices haven't reconnected since the last update.",
  severity: "LOW",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const all = await prisma.device.findMany({
      // Engine passes no args here other than the where clause we want.
      // The tenant extension adds organizationId for us.
    });
    if (all.length === 0) return [];
    const newest = all.reduce((latest, d) => {
      if (!d.agentVersion) return latest;
      return d.agentVersion > latest ? d.agentVersion : latest;
    }, "");
    if (!newest) return [];
    const stale = all.filter((d) => d.agentVersion && d.agentVersion < newest);
    if (stale.length < 5) return [];
    return [{
      windowStart, windowEnd, count: stale.length,
      evidence: {
        newestVersion: newest,
        staleSample: stale.slice(0, 10).map((d) => ({ hostname: d.hostname, agentVersion: d.agentVersion })),
      },
    }];
  },
};

export const staleDeviceBurst: DetectionRule = {
  key: "stale_device_burst",
  name: "Many devices stopped checking in",
  description: "10+ devices haven't called home in the last hour. Could be a network outage at a remote office, a bad firewall rule, or — if it's the whole fleet — the agent's MQTT/HTTPS endpoint going down.",
  severity: "MEDIUM",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
    // We can't paramaterize the where here without leaking Prisma types
    // through the loose interface; pull everything and filter in JS.
    const all = await prisma.device.findMany({});
    const stale = all.filter((d) => d.lastCheckInAt && d.lastCheckInAt < cutoff);
    if (stale.length < 10) return [];
    return [{
      windowStart, windowEnd, count: stale.length,
      evidence: { staleHostnames: stale.slice(0, 15).map((d) => d.hostname) },
    }];
  },
};

export const diskFullBurst: DetectionRule = {
  key: "disk_full_burst",
  name: "Disk-full burst across the fleet",
  description: "5+ disk_cleanup runbook attempts in 60 minutes. Often a buildup of one specific cache (Chrome, Docker, telemetry agent) that should be addressed at the source rather than reactively cleaned over and over.",
  severity: "MEDIUM",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const groups = await prisma.runbookExecution.groupBy({
      by: ["runbookKey"],
      where: { runbookKey: "disk_cleanup", startedAt: { gte: windowStart, lt: windowEnd } },
      _count: { _all: true },
    });
    const hit = groups[0];
    if (!hit || hit._count._all < 5) return [];
    return [{
      windowStart, windowEnd, count: hit._count._all,
      evidence: { runbookKey: hit.runbookKey, attempts: hit._count._all },
    }];
  },
};
