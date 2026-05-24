/**
 * Phase 21 — k6 smoke test.
 *
 * Tiny load profile (1 VU, 30 s) — just confirms the server holds up under
 * any concurrent activity at all. Use this as the pre-flight check before
 * running the bigger load.js profile.
 *
 * Run:
 *   docker run --rm -i --network host grafana/k6 run - < load/smoke.js
 *   # OR if k6 is installed natively:
 *   k6 run load/smoke.js
 */

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 1,
  duration: "30s",
  thresholds: {
    http_req_failed:   ["rate<0.01"],      // < 1% failures
    http_req_duration: ["p(95)<500"],     // 95th percentile < 500 ms
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";

export default function () {
  const healthz = http.get(`${BASE_URL}/healthz`);
  check(healthz, {
    "healthz 200":           (r) => r.status === 200,
    "healthz has ok=true":   (r) => r.body && r.body.toString().includes('"ok":true'),
  });

  const metrics = http.get(`${BASE_URL}/metrics`);
  check(metrics, {
    "metrics 200":             (r) => r.status === 200,
    "metrics has relay_ counter": (r) => r.body && r.body.toString().includes("relay_"),
  });

  sleep(0.5);
}
