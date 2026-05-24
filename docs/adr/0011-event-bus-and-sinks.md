# ADR 0011 — In-process event bus with pluggable sinks

**Status:** Accepted
**Date:** 2026-05-29

## Context

Lots of code wants to react to "a ticket was created" / "a runbook
finished" / "a detection fired". The naive approach is direct function
calls — `routes/tickets.ts` calls `notifySlack()` calls `pushToKafka()`
calls `indexInElasticsearch()` — a tightly-coupled chain.

## Options considered

- **Direct calls** — explicit and easy to trace, but every new sink
  touches every emitter.
- **Full distributed bus** (Kafka as the primary bus) — every emit goes
  external first. Robust but adds latency and infrastructure to the
  hot path.
- **In-process EventEmitter** with optional external sinks — emits stay
  fast, sinks fan out best-effort.

## Decision

Option 3. `server/src/events/bus.ts` wraps Node's EventEmitter with
typed events (`RelayEvent` union). Sinks register at boot:

- In-process consumers (notifier, metrics) attach via `bus.on(kind, fn)`.
- External sinks (Kafka, Elasticsearch) implement `EventSink.publish`
  and self-register when their env is set.

Errors in any sink are caught and logged; no sink failure can break the
caller.

## Consequences

### Positive
- Emit is sync + cheap.
- New sinks (PagerDuty, ServiceNow webhook, etc.) drop in without
  touching emitters.
- A Slack outage / Kafka outage doesn't break ticket creation.

### Negative
- Strict ordering across sinks isn't guaranteed (each runs independently).
- The in-process bus doesn't survive a process crash — if Kafka is down
  when the event fires, the event is lost. Customers who need durable
  events should configure Kafka as the primary record.

### Follow-ups
- Add an "outbox" pattern (Postgres-backed buffer) for sinks that need
  durability across crashes.
