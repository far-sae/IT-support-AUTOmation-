# ADR 0009 — Detection engine over Postgres (no SIEM dependency)

**Status:** Accepted
**Date:** 2026-05-29

## Context

We want Sigma-style "watch the firehose for these patterns" detection,
but we don't want to make a full SIEM (Splunk / Elastic SIEM / Sentinel)
a hard dependency. The data we already have in Postgres — tickets,
runbook executions, agent actions, devices — is rich enough for most
detections.

## Options considered

- **Parse arbitrary Sigma YAML** — flexible but big surface area; we
  don't ingest the raw log streams Sigma assumes.
- **External SIEM** — Splunk / Elastic SIEM. Too heavy as a default.
- **In-code Sigma-style rules running against Postgres queries** —
  every rule is a TypeScript function that pulls recent rows + emits hits.

## Decision

Option 3. Rules are TS files in `server/src/detect/builtins*.ts`. The
engine ticks every 5 minutes, runs each enabled rule per org, dedupes by
`(org, ruleKey, windowStart)`, fires NEW hits onto the event bus.

External SIEMs are still supported — they sink the event-bus events via
the Kafka / ES / Splunk / CloudWatch / Azure adapters (Phase 12 + 15).
Customers can run their detection logic centrally if they prefer.

## Consequences

### Positive
- Zero external dependency for detection.
- Rules ship with type safety, unit tests, and code review.
- 20 built-in rules covering identity, fleet, service, automation, security.

### Negative
- Adding a rule requires a code deploy (good for quality, bad for
  emergency response).
- No native Sigma YAML support — customers with existing Sigma libraries
  can't drop them in.

### Follow-ups
- Consider an admin-route DSL for "lightweight Sigma" (descriptions +
  thresholds in JSON) for emergency-response use.
