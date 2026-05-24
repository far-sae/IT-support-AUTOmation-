# Relay — load testing (k6)

## Quick smoke

```bash
docker run --rm -i --network host grafana/k6:latest run - < load/smoke.js
```

30 seconds, 1 user, hits `/healthz` + `/metrics`. Threshold: `p95 < 500ms`,
errors `< 1%`.

## Ramped load (5 minutes, up to 50 VUs)

```bash
# 1. Get a JWT
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@relay.io","password":"relay1234","orgSlug":"acme"}' \
  | jq -r .token)

# 2. Run
docker run --rm -i --network host \
  -e BASE_URL=http://localhost:4000 \
  -e TOKEN="$TOKEN" \
  grafana/k6:latest run - < load/load.js
```

Stages (5m total):
- 30s ramp to 10 VUs
- 1m  ramp to 25
- 2m  hold 50
- 1m  ramp down to 25
- 30s cooldown

Thresholds:
- Overall error rate `< 2%`
- Overall p95 `< 1000 ms`
- Analytics p95 `< 800 ms`
- Tickets p95 `< 800 ms`

## What a passing baseline looks like

On the local docker-compose stack (Apple M2 / Intel i7 dev machine):

```
http_req_duration ...........: avg=42ms min=2ms med=29ms max=618ms p(90)=98ms p(95)=149ms
http_req_failed .............: 0.00% ✓ 0 ✗ 12340
data_received ...............: 18 MB  60 kB/s
data_sent ...................: 1.8 MB 6.1 kB/s
iterations ..................: 2468  8.2/s
```

If `p(95)` shoots over 1s or errors > 2%, investigate before merging.
