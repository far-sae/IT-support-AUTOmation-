# Relay Helm chart

Parameterised install of the same workloads in [`deploy/k8s`](../../k8s/).

## Quickstart

```bash
helm install relay deploy/helm/relay \
  --namespace relay --create-namespace \
  --set image.server.tag=v0.1.0 \
  --set image.client.tag=v0.1.0 \
  --set ingress.host=relay.acme.io \
  --set-file secrets.JWT_SECRET=/dev/stdin \
  --set     secrets.DATABASE_URL="postgresql://relay:..."  \
  --set     secrets.ANTHROPIC_API_KEY="sk-ant-..."
```

For production:

1. **Disable bundled Postgres** — `--set postgres.enabled=false` and point
   `secrets.DATABASE_URL` at managed Postgres.
2. **Move secrets out of values.yaml** — use sealed-secrets,
   external-secrets, or `--set-file` with files outside Git.
3. **Set image tags** to versioned releases (never `latest`).
4. **Wire OPA** — `--set secrets.OPA_URL=http://opa.opa.svc:8181` and load
   [`deploy/opa/relay.rego`](../../opa/relay.rego) into your OPA instance.

## Useful flags

| Flag | Default | Notes |
|------|---------|-------|
| `server.replicas`           | 2          | initial server pods |
| `server.hpa.enabled`        | true       | HorizontalPodAutoscaler 2-10 |
| `server.prometheusScrape`   | true       | adds the scrape annotations |
| `client.replicas`           | 2          |  |
| `postgres.enabled`          | true       | set false for managed DB |
| `ingress.enabled`           | true       | flip off for behind-LB installs |
| `ingress.tls.enabled`       | true       | needs cert-manager OR pre-created secret |
| `networkPolicy.enabled`     | true       | default-deny + per-app allowances |
