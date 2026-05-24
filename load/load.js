/**
 * Phase 21 — k6 load profile.
 *
 * Ramped load up to 50 concurrent users hitting the read paths
 * (analytics, ticket-list, brief, detections) for 5 minutes.
 *
 * Threshold-driven: if p95 latency exceeds 1s or error rate goes above 2%,
 * the test exits non-zero — drop this into CI to catch regressions.
 *
 * Run:
 *   BASE_URL=http://localhost:4000 TOKEN=$(./scripts/get-token.sh) k6 run load/load.js
 *
 * Get a token quickly via curl:
 *   curl -s -X POST $BASE_URL/api/auth/login \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"admin@relay.io","password":"relay1234","orgSlug":"acme"}' \
 *     | jq -r .token
 */

import http from "k6/http";
import { check, group, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 10 },     // ramp to 10
    { duration: "1m",  target: 25 },     // ramp to 25
    { duration: "2m",  target: 50 },     // hold 50
    { duration: "1m",  target: 25 },     // ramp down
    { duration: "30s", target: 0  },     // cooldown
  ],
  thresholds: {
    http_req_failed:   ["rate<0.02"],
    http_req_duration: ["p(95)<1000"],
    "http_req_duration{endpoint:analytics}": ["p(95)<800"],
    "http_req_duration{endpoint:tickets}":   ["p(95)<800"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const TOKEN    = __ENV.TOKEN;

if (!TOKEN) {
  throw new Error("Set TOKEN env to a valid JWT before running. See file header.");
}

const HEADERS = { Authorization: `Bearer ${TOKEN}` };

export default function () {
  group("read-only endpoints", () => {
    const analytics = http.get(`${BASE_URL}/api/analytics`,        { headers: HEADERS, tags: { endpoint: "analytics" } });
    check(analytics, { "analytics 200": (r) => r.status === 200 });

    const tickets = http.get(`${BASE_URL}/api/tickets`,            { headers: HEADERS, tags: { endpoint: "tickets" } });
    check(tickets, { "tickets 200": (r) => r.status === 200 });

    const brief = http.get(`${BASE_URL}/api/brief/latest`,         { headers: HEADERS, tags: { endpoint: "brief" } });
    check(brief, { "brief 200": (r) => r.status === 200 });

    const detections = http.get(`${BASE_URL}/api/detections/rules`, { headers: HEADERS, tags: { endpoint: "detections" } });
    check(detections, { "detections 200": (r) => r.status === 200 });

    const workflows = http.get(`${BASE_URL}/api/workflows`,        { headers: HEADERS, tags: { endpoint: "workflows" } });
    check(workflows, { "workflows 200": (r) => r.status === 200 });
  });

  // Realistic dwell time between page views.
  sleep(Math.random() * 2 + 1);
}
