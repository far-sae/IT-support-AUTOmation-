/**
 * Phase 27 — Wazuh adapter integration test against a vendor-faithful
 * mock that implements:
 *
 *   POST /security/user/authenticate  →  { data: { token } }
 *   GET  /alerts                       →  { data: { affected_items: [...] } }
 *
 * Verifies the token exchange, the bearer-auth GET, and field mapping.
 */

import { describe, expect, it } from "vitest";
import { jsonResponse, withMockServer } from "./mock-server.js";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.WAZUH_API_URL      = "https://wazuh-placeholder.invalid";
process.env.WAZUH_API_USER     = "wazuh-bot";
process.env.WAZUH_API_PASSWORD = "wazuh-pw-fake";

const { fetchWazuhAlerts, _resetWazuhToken } = await import("../wazuh.js");

function retargetFetch(mockBaseUrl: string): typeof fetch {
  const real = global.fetch;
  return (async (url: string | URL, init?: RequestInit) => {
    const s = typeof url === "string" ? url : url.toString();
    if (s.includes("wazuh-placeholder.invalid")) {
      const u = new URL(s);
      return real(`${mockBaseUrl}${u.pathname}${u.search}`, init);
    }
    return real(url, init);
  }) as typeof fetch;
}

describe("Wazuh integration", () => {
  it("authenticates via /security/user/authenticate then GETs /alerts with bearer", async () => {
    _resetWazuhToken();
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const alerts = await fetchWazuhAlerts(100);
        expect(alerts).toHaveLength(2);

        // Verify the token POST.
        const tokenReq = requests.find((r) => r.url === "/security/user/authenticate")!;
        expect(tokenReq.method).toBe("POST");
        expect(tokenReq.headers.authorization).toMatch(/^Basic /);
        const credBytes = Buffer.from(tokenReq.headers.authorization!.replace(/^Basic /, ""), "base64").toString("utf-8");
        expect(credBytes).toBe("wazuh-bot:wazuh-pw-fake");

        // Verify the alerts GET used the bearer.
        const alertsReq = requests.find((r) => r.url.startsWith("/alerts"))!;
        expect(alertsReq.method).toBe("GET");
        expect(alertsReq.headers.authorization).toBe("Bearer wazuh-jwt-test");
        expect(alertsReq.url).toContain("limit=100");
        expect(alertsReq.url).toContain("sort=-timestamp");

        // Spot-check the data.
        expect(alerts[0]?.id).toBe("alert-1");
        expect(alerts[0]?.rule?.mitre?.id?.[0]).toBe("T1486");
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (req, res) => {
        if (req.method === "POST" && req.url === "/security/user/authenticate") {
          jsonResponse(res, 200, { data: { token: "wazuh-jwt-test" } });
          return;
        }
        if (req.url.startsWith("/alerts")) {
          jsonResponse(res, 200, {
            data: {
              affected_items: [
                {
                  id: "alert-1", timestamp: "2026-05-22T14:00:00Z",
                  agent: { id: "001", name: "laptop-1", ip: "10.0.0.1" },
                  rule: { id: 100020, level: 12, description: "File renamed with .locked extension",
                          mitre: { id: ["T1486"], tactic: ["Impact"], technique: ["Data Encrypted for Impact"] } },
                  data: { srcip: "10.0.0.1" },
                },
                {
                  id: "alert-2", timestamp: "2026-05-22T13:59:00Z",
                  agent: { id: "002", name: "laptop-2" },
                  rule: { id: 1100, level: 5, description: "User logged in" },
                },
              ],
              total_affected_items: 2,
            },
          });
          return;
        }
        jsonResponse(res, 404, { error: 1 });
      },
    });
  });

  it("refreshes the token transparently on 401", async () => {
    _resetWazuhToken();
    let tokenCalls = 0;
    let alertCalls = 0;
    await withMockServer(async ({ baseUrl }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const alerts = await fetchWazuhAlerts(10);
        expect(alerts).toHaveLength(1);
        expect(tokenCalls).toBe(2); // initial + refresh
        expect(alertCalls).toBe(2); // first 401, second 200
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (req, res) => {
        if (req.url === "/security/user/authenticate") {
          tokenCalls++;
          jsonResponse(res, 200, { data: { token: `jwt-${tokenCalls}` } });
          return;
        }
        if (req.url.startsWith("/alerts")) {
          alertCalls++;
          if (alertCalls === 1) {
            jsonResponse(res, 401, { error: 6000, message: "token expired" });
            return;
          }
          jsonResponse(res, 200, {
            data: { affected_items: [{ id: "alert-1", rule: { id: 1, level: 7, description: "ok" } }] },
          });
        }
      },
    });
  });
});
