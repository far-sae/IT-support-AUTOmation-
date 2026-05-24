# ADR 0004 — JWT auth scoped to a single org per token

**Status:** Accepted
**Date:** 2026-05-16

## Context

A user can belong to multiple orgs (think: an MSP engineer with admin
access to several customer tenants). We needed a session model that
preserves clear tenant identity per request without allowing cross-tenant
elevation by accident.

## Options considered

- **One token per user, multi-org claims inside the JWT** — flexible, but
  every request needs to determine "which of my orgs am I acting as right
  now?" which complicates routing and audit.
- **One token per (user, org)** — switching orgs forces a re-login, but
  every request is unambiguously scoped.
- **Session cookies with server-side session table** — adds infrastructure;
  JWTs scale better for our stateless server.

## Decision

JWT bound to one `(userId, organizationId)` pair. To switch orgs the user
logs in again via `/login/:orgSlug`. The URL itself carries the slug, so
even if the user has the wrong tab open they can see which tenant they're
in.

The token's `organizationId` is what the middleware writes into ALS; the
Prisma extension then filters by it. Three layers of defence end-to-end.

## Consequences

### Positive
- Every request has exactly one org of record.
- Audit logs key cleanly by `(organizationId, userId)`.
- Multi-tab MSP engineers can have several orgs open simultaneously
  (different tabs, different JWTs).

### Negative
- Org switching = logout + login (small UX cost).
- Tokens balloon if a user has 50 orgs (one JWT per session — but they
  only need one active).

### Follow-ups
- Add a "switch organization" affordance that does the silent re-login
  flow for the MSP case.
