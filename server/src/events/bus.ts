/**
 * Phase 12 — typed event bus.
 *
 * One in-process EventEmitter, plus optional pluggable sinks (Kafka, Elasticsearch)
 * that mirror every event externally for analytics + downstream pipelines.
 *
 * Usage:
 *   import { bus } from "./events/bus.js";
 *   bus.emit({ kind: "ticket.created", organizationId, ticketId, refCode });
 *   bus.on("ticket.created", async (ev) => { ... });
 *
 * Sinks are auto-registered at boot if their env is set. They are
 * fire-and-forget — an ES outage cannot break ticket creation.
 */

import { EventEmitter } from "node:events";

// ─── Event taxonomy ──────────────────────────────────────────────────

export type RelayEvent =
  | { kind: "ticket.created";     organizationId: string; ticketId: string; refCode: string; priority: string; category: string }
  | { kind: "ticket.resolved";    organizationId: string; ticketId: string; refCode: string; durationMinutes: number; resolvedByRunbook: string | null }
  | { kind: "runbook.completed";  organizationId: string; ticketId: string; runbookKey: string; status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "AWAITING_USER" | "AWAITING_AGENT" | "AWAITING_VERIFICATION"; riskScore: number | null }
  | { kind: "sla.breached";       organizationId: string; ticketId: string; refCode: string; priority: string; minutesOver: number }
  | { kind: "detection.hit";      organizationId: string; ruleKey: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; count: number; evidence: Record<string, unknown> }
  | { kind: "agent.action";       organizationId: string; deviceId: string; actionKind: string; status: "QUEUED" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" };

export type EventKind = RelayEvent["kind"];

export type EventHandler<K extends EventKind> = (
  ev: Extract<RelayEvent, { kind: K }>,
) => void | Promise<void>;

export interface EventSink {
  name: string;
  publish: (ev: RelayEvent) => Promise<void>;
}

// ─── Bus implementation ──────────────────────────────────────────────

class EventBus {
  private inner = new EventEmitter();
  private sinks: EventSink[] = [];

  constructor() {
    // node default of 10 listeners is low for our use — bump it.
    this.inner.setMaxListeners(100);
  }

  on<K extends EventKind>(kind: K, handler: EventHandler<K>): void {
    this.inner.on(kind, (ev) => {
      Promise.resolve(handler(ev as Extract<RelayEvent, { kind: K }>)).catch((err) => {
        console.error(`[events] handler for '${kind}' threw:`, err);
      });
    });
  }

  /** Fire-and-forget. Sinks are awaited in parallel but errors swallowed. */
  emit(ev: RelayEvent): void {
    this.inner.emit(ev.kind, ev);
    for (const sink of this.sinks) {
      sink.publish(ev).catch((err) => {
        console.error(`[events] sink '${sink.name}' failed for ${ev.kind}:`, err);
      });
    }
  }

  registerSink(sink: EventSink): void {
    this.sinks.push(sink);
    console.log(`[events] registered sink '${sink.name}'`);
  }

  /** Number of registered sinks — handy for tests. */
  sinkCount(): number {
    return this.sinks.length;
  }
}

export const bus = new EventBus();
