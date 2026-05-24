# ADR 0008 — Workflow engine with Postgres-durable state

**Status:** Accepted
**Date:** 2026-05-30

## Context

Some autopilot work isn't a single runbook — it's a multi-step plan
(triage → diagnose → restart → verify; or onboarding → grant access →
wait for enrollment → notify HR). Steps may sleep for hours or pause for
human approval. The system must survive a server restart mid-plan.

## Options considered

- **Temporal** — purpose-built, very capable, but a big infrastructure
  commitment.
- **LangGraph / similar JS frameworks** — typically in-memory, lose state
  on restart.
- **Custom Postgres-durable executor** — single transaction per step
  transition, cron-driven advancer.

## Decision

A small custom executor in `server/src/workflows/engine.ts`:

- `WorkflowExecution` row records the run; `WorkflowStepExecution` rows
  record each step's status / output.
- A cron ticks every minute, picks executions in `RUNNING` or `WAITING`,
  advances one step per execution.
- Each step's `execute()` returns COMPLETED / WAITING (with `resumeAt`) /
  FAILED — these transitions are one DB call.
- Compensation: on FAILED, the executor walks completed steps in reverse
  and runs each one's `compensate()` if defined.

## Consequences

### Positive
- No new infrastructure — Postgres is already there.
- Resumable: kill the server mid-plan, restart, the executor picks up
  from the last persisted state.
- Cheap to add a new workflow — one file + register.

### Negative
- No parallel steps yet (executor is one-step-at-a-time per execution).
- No retry-with-backoff — failures go straight to compensation.
- Cron granularity = 1 minute; sub-minute step transitions are not
  supported.

### Follow-ups
- Add parallel branch support (a step returns multiple sub-step IDs).
- Add retry config per step.
