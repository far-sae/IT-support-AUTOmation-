# ADR 0015 — Helm chart with bundled Postgres for demos, BYO for prod

**Status:** Accepted
**Date:** 2026-06-03

## Context

We want Relay to be installable with one command for evaluations
(`helm install ...`) and also work on the customer's existing managed
Postgres for production (RDS, Cloud SQL, Azure DB for Postgres).

## Options considered

- **Always-bundled Postgres** — easy install, terrible for production
  (single point of failure, our team can't operate every customer's DB).
- **Always-BYO Postgres** — proper but evaluators have to provision DB
  before they can try the product.
- **Bundled by default, opt-out via flag** — `helm install` works for
  evaluation; `--set postgres.enabled=false` for production.

## Decision

Option 3. `deploy/helm/relay/values.yaml` exposes `postgres.enabled`
(default true). When false, the StatefulSet is skipped and the customer
must set `secrets.DATABASE_URL` to point at their managed instance.

The bundled Postgres is `postgres:16-alpine` with a single replica and a
20Gi PVC. Documented as demo-grade in the chart README.

## Consequences

### Positive
- 30-second eval install via Helm.
- Production deployments use managed Postgres without contortions.
- No coupling between Relay's K8s manifests and the customer's DB ops
  team.

### Negative
- Two install paths to document.
- The bundled Postgres has zero HA — customers who don't read the README
  may run it in production accidentally. Mitigation: explicit warning in
  the chart README + a NOTES.txt that fires after install.

### Follow-ups
- Add a NOTES.txt post-install hook that prints "you have bundled
  Postgres enabled; this is not for production".
