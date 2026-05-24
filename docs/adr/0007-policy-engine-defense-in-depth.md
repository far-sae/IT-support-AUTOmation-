# ADR 0007 — Built-in TS policies + optional OPA layer

**Status:** Accepted
**Date:** 2026-05-23

## Context

The autopilot can take real actions in production. Customers need
deterministic, auditable rules about what's allowed, when, and by whom —
beyond the simple "HIGH risk needs approval" tier system.

## Options considered

- **Hard-code policy logic into runbooks** — fast but every runbook
  rediscovers the rules; testing each is duplicative.
- **OPA-only** — fully external, very flexible, but a hard dependency on
  a Go process customers must run.
- **Built-in TS policies + OPA as a layer on top** — keep the obvious
  always-on guards in code (business hours, mass-action limits, quiet
  hours); offer OPA for customer-specific compliance constraints.

## Decision

Two layers, with explicit ordering:

1. **In-process TS policies** (`server/src/policies/builtins.ts`) — five
   default guards. First DENY wins.
2. **OPA** (`server/src/policies/opa.ts`) — consulted *only after* every
   built-in returned ALLOW. OPA can only ADD denials, never override a
   built-in DENY. Fail-open if OPA is unreachable.

Defence-in-depth semantics: a network partition that breaks OPA cannot
weaken the built-in guards. A misconfigured OPA bundle cannot grant
broader access than the built-ins allow.

## Consequences

### Positive
- Customers without OPA still get strong defaults.
- Customers with compliance teams can write Rego rules without rebuilding
  Relay.
- Built-in policies are TS-typed and unit-tested.

### Negative
- Two policy languages (TS + Rego) for security teams to learn.
- The "OPA fail-open" choice means an OPA outage doesn't block actions —
  this is a deliberate trade against the alternative ("OPA outage = full
  Relay outage"). Documented in the threat model.

### Follow-ups
- Consider exposing a "fail-closed" toggle for high-compliance customers.
