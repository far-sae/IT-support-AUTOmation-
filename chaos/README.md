# Relay — chaos testing (Toxiproxy)

Layer Toxiproxy in front of the Postgres connection so we can inject
realistic failure modes — latency, packet-loss, connection cuts — and
observe how the server + autopilot behave.

## What's wired

- **docker-compose.chaos.yml** — adds a `toxiproxy` container and re-points
  the server's `DATABASE_URL` through it.
- **toxiproxy.json** — declares one proxy: `relay-pg` (server-facing) →
  `postgres:5432` (real DB).
- **bootstrap.sh** — drives three scenarios end-to-end:
  1. 500 ms latency + jitter on every read
  2. Random byte-slicing (lossy connection)
  3. Hard timeout (DB unreachable for the duration)

## Quick start

```bash
./chaos/bootstrap.sh
```

## Manual exploration

```bash
# Inject a custom toxic via the admin API:
curl -X POST http://localhost:8474/proxies/relay-pg/toxics \
  -H 'Content-Type: application/json' \
  -d '{"name":"slow","type":"latency","attributes":{"latency":250,"jitter":50}}'

# List active toxics
curl http://localhost:8474/proxies/relay-pg/toxics | jq

# Remove a specific one
curl -X DELETE http://localhost:8474/proxies/relay-pg/toxics/slow
```

## What to look for during chaos

- **Server doesn't crash** under any of the three scenarios — it should
  return 5xx on the affected requests and recover when the toxic clears.
- **Connection pool doesn't get poisoned** — after the timeout scenario,
  the next `/api/analytics` call should succeed.
- **Background crons (SLA, autopilot, detection, ML) shouldn't go into a
  tight retry loop** — check logs for repeated identical error lines.
- **Detection rule `workflow_compensating_burst` may fire** if any
  in-flight workflows were mid-step when Postgres became unreachable —
  this is the expected behavior, not a bug.
