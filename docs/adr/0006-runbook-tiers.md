# ADR 0006 — Four tiers of runbooks with risk-gated execution

**Status:** Accepted
**Date:** 2026-05-24

## Context

Different runbooks have wildly different blast radii. `password_reset`
is read-only and affects one account; `terraform_apply` can re-provision
fleet infrastructure. We needed a model where the engine treats them
differently without each runbook reinventing the policy.

## Options considered

- **One uniform risk level** — every runbook gets the same approval flow.
  Too cautious for safe runbooks, too lax for dangerous ones.
- **Per-runbook approval policy file** — flexible but more places to keep
  in sync.
- **LOW/MEDIUM/HIGH tiers + a small set of tier-specific rules in the
  engine** — every runbook declares its tier; the engine enforces the
  approval gate.

## Decision

Three risk tiers + four runbook categories ("Tier 1-4" in code):

| Tier | What | Approval |
|---|---|---|
| 1 | Identity / account (LOW)        | auto |
| 2 | Local agent actions (MEDIUM)    | auto with verification timer |
| 3 | External ops (HIGH — e.g. GitHub dispatch) | requires admin approve |
| 4 | Infra actions (HIGH — Terraform/Ansible/Firewall) | requires admin approve |

The engine creates HIGH-risk executions as `AWAITING_AGENT`. `execute()`
runs only after an admin clicks approve. The risk score (`policies/risk.ts`)
adds a numeric overlay (0-100) that's stored on every execution for audit.

## Consequences

### Positive
- One file per runbook; tier is just `risk: "HIGH"`.
- The engine enforces the tier rule centrally.
- Audit trail records both the qualitative tier and the numeric risk.

### Negative
- No way to express conditional tier (e.g. "MEDIUM but HIGH if production").
  Future ADR may add a `risk: (ctx) => "LOW" | "MEDIUM" | "HIGH"` callback.

### Follow-ups
- Consider a CRITICAL tier for runbooks that need two-person approval.
