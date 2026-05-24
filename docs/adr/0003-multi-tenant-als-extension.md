# ADR 0003 — Multi-tenant via AsyncLocalStorage + Prisma `$extends`

**Status:** Accepted
**Date:** 2026-05-16

## Context

Several customers want a single Relay instance to serve multiple
organisations with strict data isolation. A bug that leaks one tenant's
ticket into another tenant's view is catastrophic. We needed a design
that makes such bugs **structurally impossible**, not just unlikely.

## Options considered

- **Schema-per-tenant** — strongest isolation, painful migrations across
  hundreds of schemas, expensive per-tenant connections.
- **Row-level security in Postgres** — strong but couples our app deeply
  to Postgres RLS, harder to migrate to another DB later.
- **Explicit `where: { organizationId }` in every route** — the obvious
  approach, but a single missed call is a leak.
- **AsyncLocalStorage + Prisma extension** — JWT contains org context, an
  ALS holds it for the request, a Prisma `$extends({ query: ... })`
  intercepts every operation and injects the filter.

## Decision

Option 4 — three layers of defence:

1. **JWT** carries the user's `organizationId`.
2. **`requireAuth` middleware** sets an ALS context for the request.
3. **Prisma extension** (`server/src/db.ts`) intercepts every query
   against a tenant-scoped model and auto-adds `where: { organizationId }`
   on reads + writes, and injects on create / upsert.

A missed call in a route still doesn't leak — the DB layer adds the filter.

An escape hatch (`basePrismaUnscoped`) exists for the small number of
truly cross-tenant operations (loading the user during auth before
context exists, platform-admin tooling). Code review flags any new use.

## Consequences

### Positive
- Tenant isolation is testable as one invariant.
  ([server/src/tenant/isolation.test.ts](../../server/src/tenant/isolation.test.ts))
- Routes are simpler — no `organizationId` clutter in every query.
- Adding a new tenant-scoped model is one entry in `TENANT_SCOPED_MODELS`.

### Negative
- Prisma `$extends` types are gnarly; tests need stubs that satisfy the
  structural type.
- ALS adds a small per-request overhead (~µs).
- Background jobs must remember to call `runWithTenant(orgId, fn)`.

### Follow-ups
- Add a lint rule that flags imports of `basePrismaUnscoped` outside
  approved files.
