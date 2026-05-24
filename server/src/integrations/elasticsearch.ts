/**
 * Phase 12 — Elasticsearch adapter.
 *
 * If ELASTICSEARCH_URL is set:
 *   • a Client is built and tickets/comments are indexed on resolve/create
 *     (via the event bus sink below).
 *   • the search service uses ES with multi-match queries.
 *
 * Otherwise:
 *   • indexes are no-ops.
 *   • search falls back to Postgres ILIKE on description.
 *
 * Index naming: `${ELASTICSEARCH_INDEX_PREFIX}-tickets`,
 *               `${ELASTICSEARCH_INDEX_PREFIX}-events`.
 */

import type { Client } from "@elastic/elasticsearch";
import { env } from "../env.js";
import type { EventSink, RelayEvent } from "../events/bus.js";
import { basePrismaUnscoped } from "../db.js";

let client: Client | null = null;

export async function getEsClient(): Promise<Client | null> {
  if (client) return client;
  if (!env.ELASTICSEARCH_URL) return null;

  const { Client: ClientClass } = (await import("@elastic/elasticsearch")) as unknown as {
    Client: new (opts: { node: string; auth?: { apiKey: string } }) => Client;
  };
  client = new ClientClass({
    node: env.ELASTICSEARCH_URL,
    ...(env.ELASTICSEARCH_API_KEY ? { auth: { apiKey: env.ELASTICSEARCH_API_KEY } } : {}),
  });
  return client;
}

export function esEnabled(): boolean {
  return Boolean(env.ELASTICSEARCH_URL);
}

const TICKETS_INDEX = () => `${env.ELASTICSEARCH_INDEX_PREFIX}-tickets`;
const EVENTS_INDEX  = () => `${env.ELASTICSEARCH_INDEX_PREFIX}-events`;

/** Index (or update) a single ticket document. */
export async function esIndexTicket(ticketId: string): Promise<void> {
  const es = await getEsClient();
  if (!es) return;
  const t = await basePrismaUnscoped.ticket.findUnique({ where: { id: ticketId } });
  if (!t) return;
  await es.index({
    index: TICKETS_INDEX(),
    id: ticketId,
    document: {
      organizationId: t.organizationId,
      refCode: t.refCode,
      description: t.description,
      category: t.category,
      priority: t.priority,
      status: t.status,
      submitterName: t.submitterName,
      submitterEmail: t.submitterEmail,
      assignedTeam: t.assignedTeam,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
    },
  });
}

/** Search tickets via ES; returns empty array if ES is off. */
export async function esSearchTickets(args: {
  organizationId: string;
  query: string;
  size?: number;
}): Promise<Array<{ id: string; refCode: string; description: string; score: number }>> {
  const es = await getEsClient();
  if (!es) return [];
  const result = await es.search({
    index: TICKETS_INDEX(),
    size: args.size ?? 20,
    query: {
      bool: {
        filter: [{ term: { organizationId: args.organizationId } }],
        must: [{
          multi_match: {
            query: args.query,
            fields: ["description^2", "refCode", "category", "submitterName"],
            fuzziness: "AUTO",
          },
        }],
      },
    },
  });
  type Hit = { _id: string; _score: number; _source?: { refCode: string; description: string } };
  return (result.hits.hits as unknown as Hit[]).map((h) => ({
    id: h._id,
    refCode: h._source?.refCode ?? "",
    description: h._source?.description ?? "",
    score: h._score ?? 0,
  }));
}

/** Event-bus sink that mirrors every event to the `relay-events` index. */
export const esEventSink: EventSink = {
  name: "elasticsearch",
  async publish(ev: RelayEvent): Promise<void> {
    const es = await getEsClient();
    if (!es) return;
    await es.index({
      index: EVENTS_INDEX(),
      document: { ...ev, ingestedAt: new Date().toISOString() },
    });
    // For ticket lifecycle events, also refresh the ticket document so search
    // sees the resolved state immediately.
    if (ev.kind === "ticket.created" || ev.kind === "ticket.resolved") {
      await esIndexTicket(ev.ticketId).catch(() => undefined);
    }
  },
};

/** Wire ES into the bus if configured. Returns true when active. */
export async function registerEsSink(): Promise<boolean> {
  if (!env.ELASTICSEARCH_URL) return false;
  const { bus } = await import("../events/bus.js");
  bus.registerSink(esEventSink);
  return true;
}
