/**
 * Phase 25 — Detection rules that use the live threat-intel catalog.
 *
 *   • kev_mentioned_in_ticket — a ticket description references a CVE
 *     currently on CISA's KEV catalog. Indicates a user is reporting
 *     active exploitation in their environment.
 */

import { basePrismaUnscoped } from "../db.js";
import { alignWindowStart, type DetectionRule } from "./types.js";

const CVE_REGEX = /\bCVE-\d{4}-\d{4,7}\b/gi;

export const kevMentionedInTicket: DetectionRule = {
  key: "kev_mentioned_in_ticket",
  name: "Ticket mentions a CVE from CISA KEV",
  description: "A recent ticket description references a CVE that's currently on the CISA Known-Exploited-Vulnerabilities catalog. Users typically only mention CVE IDs when they've seen the vuln in the news — but a KEV reference often means active exploitation in this environment.",
  severity: "CRITICAL",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);

    // Tickets opened in the last 60 minutes that mention a CVE id.
    const tickets = await prisma.ticket.findMany({});
    const recent = (tickets as Array<{ id: string; refCode: string; description: string; createdAt?: Date }>)
      .filter((t) => (t.createdAt ?? new Date(0)) >= windowStart && CVE_REGEX.test(t.description));
    if (recent.length === 0) return [];

    // Collect mentioned CVE ids and check which are on KEV.
    const allCveIds = new Set<string>();
    for (const t of recent) {
      for (const m of t.description.matchAll(CVE_REGEX)) allCveIds.add(m[0].toUpperCase());
    }
    const kevHits = await basePrismaUnscoped.threatIntel.findMany({
      where: {
        kind: "KEV",
        externalId: { in: [...allCveIds] },
      },
      select: { externalId: true, title: true },
    });
    if (kevHits.length === 0) return [];

    const kevIds = new Set(kevHits.map((k) => k.externalId.toUpperCase()));
    const matchedTickets = recent.flatMap((t) => {
      const refs = [...t.description.matchAll(CVE_REGEX)]
        .map((m) => m[0].toUpperCase())
        .filter((id) => kevIds.has(id));
      return refs.length > 0 ? [{ refCode: t.refCode, cves: refs }] : [];
    });
    if (matchedTickets.length === 0) return [];

    return [{
      windowStart, windowEnd,
      count: matchedTickets.length,
      evidence: {
        tickets: matchedTickets.slice(0, 15),
        kevCount: kevHits.length,
      },
    }];
  },
};
