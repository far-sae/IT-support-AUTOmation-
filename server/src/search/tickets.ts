/**
 * Phase 12 — Unified ticket search.
 *
 * If Elasticsearch is configured, use ES (with fuzziness + multi-field scoring).
 * Otherwise fall back to a Postgres ILIKE scan that still works for the
 * single-tenant case without infrastructure dependencies.
 */

import { prisma } from "../db.js";
import { esEnabled, esSearchTickets } from "../integrations/elasticsearch.js";
import { getTenantContext } from "../tenant/context.js";

export interface TicketSearchResult {
  id: string;
  refCode: string;
  description: string;
  /** ES score, or 1 for the Postgres fallback. */
  score: number;
  source: "elasticsearch" | "postgres";
}

export async function searchTickets(query: string, limit = 20): Promise<TicketSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (esEnabled()) {
    const ctx = getTenantContext();
    const organizationId = ctx?.organizationId ?? null;
    if (!organizationId) return []; // no tenant → no results
    const hits = await esSearchTickets({ organizationId, query: trimmed, size: limit });
    return hits.map((h) => ({ ...h, source: "elasticsearch" as const }));
  }

  const rows = await prisma.ticket.findMany({
    where: {
      OR: [
        { description: { contains: trimmed, mode: "insensitive" } },
        { refCode:     { contains: trimmed, mode: "insensitive" } },
        { category:    { contains: trimmed, mode: "insensitive" } },
      ],
    },
    select: { id: true, refCode: true, description: true },
    take: limit,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ ...r, score: 1, source: "postgres" as const }));
}
