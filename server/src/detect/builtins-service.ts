/**
 * Phase 19 — Service-health detection rules.
 *
 *   • ticket_storm_unassigned — many critical tickets stuck without an agent
 *   • sla_breach_spike        — burst of SLA breaches
 *   • same_submitter_burst    — one user filing many tickets
 */

import { alignWindowStart, type DetectionRule } from "./types.js";

export const ticketStormUnassigned: DetectionRule = {
  key: "ticket_storm_unassigned",
  name: "Critical tickets stuck without an assigned agent",
  description: "3+ Critical-priority tickets in the queue with no agent assigned for over an hour. The autopilot can't help with severe issues — those need human eyes the moment they land.",
  severity: "HIGH",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
    // Filter manually since the loose Prisma type doesn't pass `where` cleanly.
    const all = await prisma.ticket.findMany({});
    const stuck = (all as Array<{
      id: string; refCode: string; submitterEmail: string; description: string;
      priority?: string; assignedAgentId?: string | null; createdAt?: Date; status?: string;
    }>).filter((t) =>
      t.priority === "Critical" && !t.assignedAgentId && t.status !== "RESOLVED" &&
      (t.createdAt ?? new Date(0)) < cutoff,
    );
    if (stuck.length < 3) return [];
    return [{
      windowStart, windowEnd, count: stuck.length,
      evidence: { refCodes: stuck.slice(0, 10).map((t) => t.refCode) },
    }];
  },
};

export const slaBreachSpike: DetectionRule = {
  key: "sla_breach_spike",
  name: "SLA breach spike",
  description: "5+ tickets crossed their SLA window in the last 30 minutes. Capacity or routing problem — either the team's swamped or tickets are landing on the wrong queue.",
  severity: "HIGH",
  windowMinutes: 30,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 30);
    const windowEnd   = new Date(windowStart.getTime() + 30 * 60 * 1000);
    const cutoff = new Date(now.getTime() - 30 * 60 * 1000);
    const all = await prisma.ticket.findMany({});
    const breached = (all as Array<{ slaAlertedAt?: Date | null; refCode: string; assignedTeam?: string }>)
      .filter((t) => t.slaAlertedAt && t.slaAlertedAt >= cutoff);
    if (breached.length < 5) return [];
    const teamCounts: Record<string, number> = {};
    for (const t of breached) {
      const team = t.assignedTeam ?? "—";
      teamCounts[team] = (teamCounts[team] ?? 0) + 1;
    }
    return [{
      windowStart, windowEnd, count: breached.length,
      evidence: {
        byTeam: teamCounts,
        sampleRefCodes: breached.slice(0, 10).map((t) => t.refCode),
      },
    }];
  },
};

export const sameSubmitterBurst: DetectionRule = {
  key: "same_submitter_burst",
  name: "One user filing an unusual number of tickets",
  description: "Single submitter has filed 10+ tickets across any category in the last hour. Either a power user pasting from a script, an angry customer working through a list, or a phishing-bot harvesting our auto-replies.",
  severity: "LOW",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const all = await prisma.ticket.findMany({});
    const recent = (all as Array<{ submitterEmail: string; refCode: string; createdAt?: Date }>)
      .filter((t) => (t.createdAt ?? new Date(0)) >= windowStart);
    const byEmail = new Map<string, string[]>();
    for (const t of recent) {
      const arr = byEmail.get(t.submitterEmail) ?? [];
      arr.push(t.refCode);
      byEmail.set(t.submitterEmail, arr);
    }
    const offenders = [...byEmail.entries()].filter(([, refs]) => refs.length >= 10);
    if (offenders.length === 0) return [];
    return [{
      windowStart, windowEnd,
      count: offenders.reduce((s, [, r]) => s + r.length, 0),
      evidence: Object.fromEntries(offenders),
    }];
  },
};
