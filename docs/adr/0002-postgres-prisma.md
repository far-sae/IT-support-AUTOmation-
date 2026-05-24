# ADR 0002 — Postgres + Prisma ORM

**Status:** Accepted
**Date:** 2026-05-15

## Context

Relay needs a relational store: multi-tenant rows with cascade deletes,
foreign keys, transactional state changes (workflow steps must transition
atomically). Schema is changing weekly (16 migrations in the first 17
phases).

## Options considered

- **Postgres + Prisma** — strong types, generated client, migrations, JSON
  column support for free-form settings.
- **Postgres + Drizzle** — newer, less mature ecosystem at the time.
- **MongoDB** — schema flexibility, but our access patterns are relational
  (joins on ticket → comment, workflow → step), not document-shaped.
- **MySQL** — works but Postgres has better JSON support (we use it
  heavily) and `tsvector` for future full-text search.

## Decision

Postgres 16 + Prisma 5. The full-text search is currently Postgres ILIKE
with optional Elasticsearch (Phase 12) for tenants who outgrow it.

## Consequences

### Positive
- Strongly-typed client; refactors propagate via tsc.
- Migrations are SQL files in the repo — readable to ops.
- JSON columns (`Organization.settings`, `RunbookExecution.decision`,
  `MlModel.weights`) keep us flexible without ALTER TABLE every week.

### Negative
- Prisma generates a large client; build time +5s.
- `$extends` is a 5.x feature — pinned, can't trivially downgrade.
- Prisma's connection pool defaults need tuning under heavy load.

### Follow-ups
- Migrate the JSON columns we know are stable to typed columns (e.g.
  `Organization.settings.businessHours`) for query performance.
