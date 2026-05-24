# ADR 0013 — Structured JSON logging with pluggable sinks

**Status:** Accepted
**Date:** 2026-05-31

## Context

`console.log` is fine for development but bad for production: no
filtering by level, hard to search, no structured fields, can't ship
to multiple destinations.

## Options considered

- **pino / winston** — battle-tested but bring transitive deps + an
  opinionated formatter.
- **Custom logger** — small, exactly what we need, no surprises.

## Decision

Custom logger in `server/src/observability/logger.ts`. Each call emits
one JSON line to stdout (so the container runtime ingests it
naturally) **and** to every registered sink. Sinks:

- `elasticsearch_logs.ts` — daily-rolling index pattern, reuses the
  Phase 12 ES client
- `splunk.ts` — Splunk HEC
- `azure_monitor.ts` — Azure Data Collector API (HMAC-signed)
- `cloudwatch.ts` — CloudWatch Logs + Metrics

Each sink self-skips when its env isn't configured.

## Consequences

### Positive
- One log line, multiple destinations.
- Sinks loaded lazily — no Splunk dep cost if you don't use Splunk.
- Stdout fallback means logs aren't lost even if every external sink
  fails.

### Negative
- Some existing code still calls `console.log` directly (not yet
  migrated). Mostly cosmetic — those lines still hit stdout, just
  without the `service` / `ts` envelope.

### Follow-ups
- Migrate the high-traffic call sites (autopilot, brain) to the
  structured logger.
- Add a PHI redactor in the logger before the fan-out.
