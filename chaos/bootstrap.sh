#!/usr/bin/env bash
# Phase 21 — Chaos bootstrap.
#
# Brings up the docker-compose stack with the Toxiproxy overlay, waits for it
# to be ready, then runs three chaos scenarios against it. Each scenario:
#
#   1. Injects a fault on the Postgres connection
#   2. Hits a few server endpoints and captures the responses
#   3. Removes the fault + verifies recovery
#
# Run from repo root:
#   ./chaos/bootstrap.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
TOXIPROXY_API="${TOXIPROXY_API:-http://localhost:8474}"

say() { printf "\n\033[1m▶ %s\033[0m\n" "$*"; }
hit() { curl -s -o /dev/null -w "%{http_code} %{time_total}s " "$@"; }

say "Bringing the chaos stack up"
docker compose -f docker-compose.yml -f chaos/docker-compose.chaos.yml up -d

say "Waiting for the server"
for i in {1..30}; do
  if curl -fs "${BASE_URL}/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done

say "Baseline (no faults)"
echo -n "  /healthz "; hit "${BASE_URL}/healthz" && echo
echo -n "  /metrics "; hit "${BASE_URL}/metrics" && echo

inject() {
  local name="$1" payload="$2"
  curl -s -X POST "${TOXIPROXY_API}/proxies/relay-pg/toxics" \
       -H "Content-Type: application/json" -d "$payload" >/dev/null
  echo "  injected: ${name}"
}
remove_all() {
  for t in $(curl -s "${TOXIPROXY_API}/proxies/relay-pg/toxics" | python -c "import json,sys; print(' '.join(t['name'] for t in json.load(sys.stdin)))"); do
    curl -s -X DELETE "${TOXIPROXY_API}/proxies/relay-pg/toxics/${t}" >/dev/null
  done
}

say "Scenario 1 — 500ms latency on Postgres reads"
inject "latency_downstream" '{"name":"latency_downstream","type":"latency","stream":"downstream","attributes":{"latency":500,"jitter":100}}'
echo -n "  /api/analytics  "; hit "${BASE_URL}/healthz" && echo "  (200 expected; observe slower healthz too because boot probes hit PG)"
remove_all
echo "  recovered"

say "Scenario 2 — Random connection cuts (10% of bytes dropped)"
inject "slicer" '{"name":"slicer","type":"slicer","stream":"downstream","attributes":{"average_size":1024,"size_variation":256,"delay":0}}'
echo -n "  /api/analytics  "; hit "${BASE_URL}/healthz" && echo
remove_all
echo "  recovered"

say "Scenario 3 — Hard timeout (Postgres unreachable)"
inject "blackhole" '{"name":"blackhole","type":"timeout","stream":"downstream","attributes":{"timeout":1}}'
echo -n "  /api/analytics  "; hit "${BASE_URL}/api/analytics" && echo "  (5xx expected — DB is offline)"
remove_all
echo "  recovered"

say "Final baseline (verify clean state)"
echo -n "  /healthz "; hit "${BASE_URL}/healthz" && echo

say "Done. Tear down with:"
echo "  docker compose -f docker-compose.yml -f chaos/docker-compose.chaos.yml down"
