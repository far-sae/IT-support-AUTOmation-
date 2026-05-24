# ADR 0010 — Pure-TS ML with optional Python sidecar

**Status:** Accepted
**Date:** 2026-06-01

## Context

The brain uses a learned classifier to predict `P(success | ticket, runbook,
history)`. We need this to ship as part of the server without forcing
customers to run a Python service, but we also don't want to permanently
limit ourselves to the JS ML ecosystem.

## Options considered

- **TensorFlow.js / ONNX in-process** — big runtime, slow startup.
- **Pure-TS implementation** — small, no deps, simple to deploy.
- **Required Python sidecar** — best ML libraries but increases operational
  footprint.
- **TS implementation by default, sidecar as opt-in** — pay the operational
  cost only when you need the ML quality.

## Decision

Two-layer:

1. **Pure-TS implementation** (`server/src/ml/logistic.ts` for Phase 16,
   `server/src/ml/gbt.ts` for Phase 20). Logistic regression for cold-start,
   gradient-boosted decision stumps once we have ≥50 per-attempt rows.
2. **Optional Python sidecar** (`deploy/ml-sidecar/`) — FastAPI + sklearn
   `HistGradientBoostingClassifier`. Activates when `ML_SIDECAR_URL` is set.
   The Node server POSTs feature batches for training and individual
   vectors for inference.

## Consequences

### Positive
- Default deployment is single-service.
- Customers can graduate to the sidecar when their dataset is big enough
  to benefit.
- The TS GBT is unit-testable and learns interpretable rules.

### Negative
- Two ML implementations to maintain (we make sure they agree on the
  feature contract).
- The TS GBT is decision-stumps-only; for deep non-linearities you'd want
  the sidecar (or a deeper TS implementation).

### Follow-ups
- Add a CI job that compares the two implementations on the same dataset
  and fails if accuracy diverges by > 5 %.
