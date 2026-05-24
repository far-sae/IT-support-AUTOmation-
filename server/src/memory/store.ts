/**
 * Vector-memory store.
 *
 *   indexResolvedTicket — call after a ticket flips to RESOLVED. Embeds the
 *     "<category>: <description>" text and stores it, plus a pointer to the
 *     winning runbook for quick reference.
 *
 *   searchSimilar — finds the top-N most similar past tickets for a query
 *     description, scoped to the caller's organisation. The brain uses
 *     this before deciding which runbook to fire.
 */

import { prisma } from "../db.js";
import { embed, cosine, MODEL_KEY } from "./embeddings.js";

export async function indexResolvedTicket(ticketId: string): Promise<void> {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!t) return;

  const text = `${t.category}: ${t.description}`;
  const vector = embed(text);

  await prisma.ticketEmbedding.upsert({
    where: { ticketId },
    create: {
      organizationId: t.organizationId,
      ticketId,
      text,
      vector: vector as unknown as object,
      model: MODEL_KEY,
    },
    update: { text, vector: vector as unknown as object, model: MODEL_KEY },
  });
}

export interface Memory {
  ticketId: string;
  refCode: string;
  category: string;
  similarity: number;
  resolvedAt: Date | null;
  winningRunbook: string | null;
}

/**
 * Return the top `k` most similar resolved tickets (excluding the supplied
 * ticketId so the brain doesn't recall itself). The tenant ALS context
 * keeps the scope to the caller's org via the Prisma extension.
 */
export async function searchSimilar(args: {
  description: string;
  category: string;
  excludeTicketId?: string;
  k?: number;
}): Promise<Memory[]> {
  const k = args.k ?? 5;
  const query = embed(`${args.category}: ${args.description}`);

  // Pull all embeddings for the org; Postgres handles a few thousand rows
  // fine in memory. Filter out non-current embedder models so we don't
  // mix cosine spaces if we change embedders.
  const rows = await prisma.ticketEmbedding.findMany({
    where: {
      model: MODEL_KEY,
      ...(args.excludeTicketId ? { ticketId: { not: args.excludeTicketId } } : {}),
    },
    include: {
      ticket: {
        select: {
          refCode: true, category: true, resolvedAt: true,
          runbookExecutions: {
            where: { status: "SUCCEEDED" },
            orderBy: { startedAt: "desc" }, take: 1,
            select: { runbookKey: true },
          },
        },
      },
    },
    take: 1000,
  });

  const scored = rows.map((r) => ({
    ticketId: r.ticketId,
    refCode: r.ticket.refCode,
    category: r.ticket.category,
    resolvedAt: r.ticket.resolvedAt,
    winningRunbook: r.ticket.runbookExecutions[0]?.runbookKey ?? null,
    similarity: cosine(query, r.vector as unknown as number[]),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k).filter((s) => s.similarity > 0.15);
}
