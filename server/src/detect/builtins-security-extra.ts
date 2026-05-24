/**
 * Phase 19 — Additional security-pattern detection rules.
 *
 *   • encryption_extension_burst — many tickets mentioning known-ransomware extensions
 *   • after_hours_admin_action   — agent actions dispatched at 22:00–06:00 UTC
 *   • data_exfil_keywords        — tickets mentioning extraction/copy/upload of bulk data
 */

import { alignWindowStart, type DetectionRule } from "./types.js";

// Known ransomware/locker file extensions (sample — real deployments would
// fold in IOC feeds). Matching ANY of these in a recent ticket is suspicious.
const LOCKER_EXTENSIONS = [
  ".locked", ".crypted", ".encrypted", ".lockbit", ".conti",
  ".ryuk", ".revil", ".blackcat", ".alphv", ".royal",
];

export const encryptionExtensionBurst: DetectionRule = {
  key: "encryption_extension_burst",
  name: "Multiple tickets mention ransomware file extensions",
  description: "3+ recent tickets mention a known ransomware file extension (.locked, .crypted, .lockbit, .conti, …). Time to wake the on-call.",
  severity: "CRITICAL",
  windowMinutes: 30,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 30);
    const windowEnd   = new Date(windowStart.getTime() + 30 * 60 * 1000);
    const all = await prisma.ticket.findMany({});
    const matched: Array<{ refCode: string; extension: string }> = [];
    for (const t of all as Array<{ refCode: string; description: string; createdAt?: Date }>) {
      if ((t.createdAt ?? new Date(0)) < windowStart) continue;
      const lower = t.description.toLowerCase();
      for (const ext of LOCKER_EXTENSIONS) {
        if (lower.includes(ext)) { matched.push({ refCode: t.refCode, extension: ext }); break; }
      }
    }
    if (matched.length < 3) return [];
    return [{
      windowStart, windowEnd, count: matched.length,
      evidence: { hits: matched.slice(0, 15) },
    }];
  },
};

export const afterHoursAdminAction: DetectionRule = {
  key: "after_hours_admin_action",
  name: "Agent actions dispatched outside business hours",
  description: "5+ agent actions were created between 22:00 and 06:00 UTC. Either the team's working unusually late, or an automated process is firing when it shouldn't. Worth a sanity check.",
  severity: "MEDIUM",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    // Only fire if `now` itself falls in the off-hours window — otherwise
    // we'd alert on the morning replay of overnight activity.
    const h = now.getUTCHours();
    if (h >= 6 && h < 22) return [];

    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const groups = await prisma.agentAction.groupBy({
      by: ["status"],
      where: { createdAt: { gte: windowStart, lt: windowEnd } },
      _count: { _all: true },
    });
    const total = groups.reduce((s, g) => s + g._count._all, 0);
    if (total < 5) return [];
    return [{
      windowStart, windowEnd, count: total,
      evidence: { byStatus: Object.fromEntries(groups.map((g) => [g.status, g._count._all])) },
    }];
  },
};

const EXFIL_PATTERNS = /\b(exfiltrat|bulk\s+(export|download|upload)|copy(ing)?\s+(everything|all\s+files)|mass\s+(download|export))\b/i;

export const dataExfilKeywords: DetectionRule = {
  key: "data_exfil_keywords",
  name: "Tickets mentioning bulk data extraction",
  description: "2+ tickets mention bulk export / download / exfiltration verbs in the last hour. Could be a legitimate migration project — could be the panic ticket from a user who just spotted unusual activity in their drive.",
  severity: "HIGH",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const all = await prisma.ticket.findMany({});
    const matched = (all as Array<{ refCode: string; description: string; createdAt?: Date; submitterEmail: string }>)
      .filter((t) => (t.createdAt ?? new Date(0)) >= windowStart && EXFIL_PATTERNS.test(t.description));
    if (matched.length < 2) return [];
    return [{
      windowStart, windowEnd, count: matched.length,
      evidence: { refCodes: matched.slice(0, 10).map((t) => t.refCode) },
    }];
  },
};
