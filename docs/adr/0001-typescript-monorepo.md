# ADR 0001 — TypeScript monorepo with three workspaces

**Status:** Accepted
**Date:** 2026-05-15

## Context

Relay started as a single-engineer product needing a server (HTTP + cron),
a browser client, and an OS-level agent (Node CLI) that runs on the
customer's hosts. All three share a non-trivial amount of domain types
(Ticket, Runbook, Workflow, etc.) and the type definitions are the
contract.

## Options considered

- **Three separate repos** — clean separation, but type drift becomes the
  single biggest source of bugs as the team grows. Sharing schema means
  copy/pasting `Ticket` interfaces and discovering they diverged.
- **Single repo with three top-level directories, no workspaces** — simple
  but tooling (typecheck-all, test-all, dep-dedup) is bespoke.
- **npm workspaces in a single repo** — built-in monorepo support, dedupes
  deps, simple `npm run test --workspace server`.
- **Nx / Turbo** — better caching but heavier setup; deferred until we
  have a real CI bottleneck.

## Decision

Single repo, npm workspaces, three packages: `server`, `client`, `agent`.
Shared types live in `@prisma/client` (generated from the schema) and a
small `types.ts` in each workspace.

## Consequences

### Positive
- Schema-derived types share across server + client via Prisma.
- One `npm install` for the whole tree.
- ESLint / Prettier / TypeScript config in one place.

### Negative
- A breaking change to `Ticket` shape requires touching all three
  packages in one PR (we treat this as a feature, not a bug).
- No build-graph caching yet; full typecheck takes ~10s today, acceptable.

### Follow-ups
- Migrate to Turborepo when CI typecheck exceeds 60s.
