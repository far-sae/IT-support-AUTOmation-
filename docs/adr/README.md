# Relay — Architecture Decision Records

Each ADR captures one significant design decision: the context that
forced it, the options considered, the choice, and the consequences.
Numbered in the order the decisions were *made*, not the order the
documents were written. Many of these were written retroactively in
Phase 24 to document Phase 1-23 decisions for an auditor or new
engineer's benefit.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-typescript-monorepo.md) | TypeScript monorepo with three workspaces | Accepted |
| [0002](0002-postgres-prisma.md) | Postgres + Prisma ORM | Accepted |
| [0003](0003-multi-tenant-als-extension.md) | Multi-tenant via AsyncLocalStorage + Prisma `$extends` | Accepted |
| [0004](0004-jwt-with-org-slug.md) | JWT auth scoped to a single org per token | Accepted |
| [0005](0005-rule-brain-with-ai-fallback.md) | Rule brain first, Claude tool-use as fallback | Accepted |
| [0006](0006-runbook-tiers.md) | Four tiers of runbooks with risk-gated execution | Accepted |
| [0007](0007-policy-engine-defense-in-depth.md) | Built-in TS policies + optional OPA layer | Accepted |
| [0008](0008-workflow-engine-postgres-durable.md) | Workflow engine with Postgres-durable state | Accepted |
| [0009](0009-detection-engine-postgres-only.md) | Detection engine over Postgres (no Sigma YAML, no SIEM dependency) | Accepted |
| [0010](0010-ml-pure-ts-with-sidecar-option.md) | Pure-TS ML with optional Python sidecar | Accepted |
| [0011](0011-event-bus-and-sinks.md) | In-process event bus + optional Kafka/ES/Splunk/etc. sinks | Accepted |
| [0012](0012-no-pgvector.md) | No pgvector — hashed local embeddings stored as JSON | Accepted |
| [0013](0013-structured-json-logging.md) | Structured JSON logger with pluggable sinks | Accepted |
| [0014](0014-vendor-mock-server-tests.md) | Integration tests against in-process vendor mocks | Accepted |
| [0015](0015-helm-k8s-bring-your-own-postgres.md) | Helm chart with bundled Postgres for demos, managed for prod | Accepted |

## Process for new ADRs

1. Copy the template at `_template.md`
2. Increment the number
3. Write context → options → decision → consequences. Be honest about
   trade-offs you accepted
4. Submit alongside the code change that implements the decision
5. PRs that violate an existing ADR must either supersede it (with a new
   ADR documenting why) or fix themselves

## How an auditor reads these

Each ADR is a 1-page narrative. An auditor can read all 15 in 30 minutes
and have a complete picture of the architectural trade-offs without
spelunking the code. That's the value: a faithful, human-readable
history that won't drift.
