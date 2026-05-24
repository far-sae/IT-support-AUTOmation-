/**
 * Phase 26 — Commercial threat-intel adapters tested against
 * vendor-faithful mock servers.
 *
 *   • Mandiant — OAuth-token flow + /v4/vulnerability
 *   • Recorded Future — X-RFToken auth + /v2/vulnerability/search
 *   • CrowdStrike — OAuth client_credentials + /intel/combined/vulnerabilities/v1
 */

import { describe, expect, it } from "vitest";
import { jsonResponse, withMockServer } from "../../integrations/__test__/mock-server.js";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.MANDIANT_API_KEY    = "mand-key-fake";
process.env.MANDIANT_API_SECRET = "mand-sec-fake";
process.env.MANDIANT_API_BASE   = "https://mandiant-placeholder.invalid";
process.env.RECORDED_FUTURE_API_KEY  = "rf-token-fake";
process.env.RECORDED_FUTURE_API_BASE = "https://recordedfuture-placeholder.invalid";
process.env.CROWDSTRIKE_CLIENT_ID     = "cs-client-fake";
process.env.CROWDSTRIKE_CLIENT_SECRET = "cs-secret-fake";
process.env.CROWDSTRIKE_API_BASE      = "https://crowdstrike-placeholder.invalid";

const { mandiantSource, _resetMandiantTokenCache } = await import("../sources/mandiant.js");
const { recordedFutureSource } = await import("../sources/recorded_future.js");
const { crowdstrikeSource, _resetCrowdstrikeTokenCache } = await import("../sources/crowdstrike.js");

function retargetFetch(placeholderHost: string, mockBaseUrl: string): typeof fetch {
  const real = global.fetch;
  return (async (url: string | URL, init?: RequestInit) => {
    const s = typeof url === "string" ? url : url.toString();
    if (s.includes(placeholderHost)) {
      const u = new URL(s);
      return real(`${mockBaseUrl}${u.pathname}${u.search}`, init);
    }
    return real(url, init);
  }) as typeof fetch;
}

// ─── Mandiant ────────────────────────────────────────────────────────

describe("Mandiant integration", () => {
  it("performs the token exchange + maps a vuln including malware/actor associations", async () => {
    _resetMandiantTokenCache();
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch("mandiant-placeholder.invalid", baseUrl);
      try {
        const items = await mandiantSource.fetch();
        expect(items.length).toBe(2);

        // Verify the token call happened with HTTP Basic auth.
        const tokenReq = requests.find((r) => r.url === "/token")!;
        expect(tokenReq.method).toBe("POST");
        expect(tokenReq.headers["content-type"]).toMatch(/x-www-form-urlencoded/);
        expect(tokenReq.headers.authorization).toMatch(/^Basic /);
        const credBytes = Buffer.from(tokenReq.headers.authorization!.replace(/^Basic /, ""), "base64").toString("utf-8");
        expect(credBytes).toBe("mand-key-fake:mand-sec-fake");
        expect(tokenReq.body).toContain("grant_type=client_credentials");

        // Verify the vuln list call used the bearer.
        const vulnReq = requests.find((r) => r.url.startsWith("/v4/vulnerability"))!;
        expect(vulnReq.headers.authorization).toBe("Bearer mand-bearer-test");

        // Verify field mapping. The exploitation_state="Wide" promotes severity.
        const wide = items.find((i) => i.externalId === "CVE-2026-99001")!;
        expect(wide.severity).toBe("CRITICAL"); // promoted by exploitation_state
        expect(wide.description).toMatch(/Linked malware: AcmeRansom/);
        expect(wide.description).toMatch(/Linked actors: APT-Acme/);
        expect(wide.affected).toContain("Acme");
        expect(wide.affected).toContain("WebServer");

        // The normal-severity item maps via CVSS.
        const normal = items.find((i) => i.externalId === "CVE-2026-99002")!;
        expect(normal.severity).toBe("HIGH"); // CVSS 7.5
        expect(normal.cvss).toBe(7.5);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (req, res) => {
        if (req.method === "POST" && req.url === "/token") {
          jsonResponse(res, 200, { access_token: "mand-bearer-test", token_type: "Bearer", expires_in: 1800 });
          return;
        }
        if (req.url.startsWith("/v4/vulnerability")) {
          jsonResponse(res, 200, {
            vulnerabilities: [
              {
                cve_id: "CVE-2026-99001",
                title: "Acme WebServer RCE",
                description: "Remote unauthenticated RCE.",
                published_date: "2026-05-22T00:00:00Z",
                common_vulnerability_scores: { "v3.1": { base_score: 9.8 } },
                analysis: {
                  exploitation_state: "Wide",
                  exploitation_consequence: "Code Execution",
                  vendor_fix_references: [{ url: "https://example.com/patch" }],
                },
                affected_vendors_products: [{ vendor: "Acme", product: "WebServer" }],
                associations: {
                  malware_families: [{ name: "AcmeRansom" }],
                  actors:           [{ name: "APT-Acme" }],
                },
                mscore: 95,
              },
              {
                cve_id: "CVE-2026-99002",
                title: "Globex Mail XSS",
                description: "Stored XSS.",
                published_date: "2026-05-21T00:00:00Z",
                common_vulnerability_scores: { "v3.1": { base_score: 7.5 } },
                affected_vendors_products: [{ vendor: "Globex", product: "Mail" }],
                mscore: 72,
              },
            ],
            total_count: 2, offset: 0, limit: 100,
          });
          return;
        }
        jsonResponse(res, 404, {});
      },
    });
  });

  it("retries once on a mid-flight 401 (token rotated)", async () => {
    _resetMandiantTokenCache();
    let tokenCalls = 0, vulnCalls = 0;
    await withMockServer(async ({ baseUrl }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch("mandiant-placeholder.invalid", baseUrl);
      try {
        const items = await mandiantSource.fetch();
        expect(items.length).toBe(1);
        // We got TWO token calls (initial + retry) and TWO vuln calls (first 401, second 200).
        expect(tokenCalls).toBe(2);
        expect(vulnCalls).toBe(2);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (req, res) => {
        if (req.method === "POST" && req.url === "/token") {
          tokenCalls++;
          jsonResponse(res, 200, { access_token: `tok-${tokenCalls}`, token_type: "Bearer", expires_in: 1800 });
          return;
        }
        if (req.url.startsWith("/v4/vulnerability")) {
          vulnCalls++;
          if (vulnCalls === 1) {
            jsonResponse(res, 401, { error: "token expired" });
            return;
          }
          jsonResponse(res, 200, {
            vulnerabilities: [{
              cve_id: "CVE-2026-99003", title: "demo",
              published_date: "2026-05-22T00:00:00Z",
              common_vulnerability_scores: { "v3.1": { base_score: 5.0 } },
              affected_vendors_products: [{ vendor: "X", product: "Y" }],
            }],
          });
        }
      },
    });
  });
});

// ─── Recorded Future ─────────────────────────────────────────────────

describe("Recorded Future integration", () => {
  it("POSTs the search payload with X-RFToken + maps risk → severity", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch("recordedfuture-placeholder.invalid", baseUrl);
      try {
        const items = await recordedFutureSource.fetch();
        expect(items.length).toBe(3);

        const req = requests[0]!;
        expect(req.method).toBe("POST");
        expect(req.url).toBe("/v2/vulnerability/search");
        expect(req.headers["x-rftoken"]).toBe("rf-token-fake");
        const body = req.parsedBody as { filter: { risk: { gte: number }; lastSeen: { gte: string } } };
        expect(body.filter.risk.gte).toBe(70);
        expect(body.filter.lastSeen.gte).toBe("P1D");

        const crit = items.find((i) => i.externalId === "CVE-2026-RF001")!;
        expect(crit.severity).toBe("CRITICAL");
        expect(crit.references.some((u) => u.includes("recordedfuture"))).toBe(true);

        const high = items.find((i) => i.externalId === "CVE-2026-RF002")!;
        expect(high.severity).toBe("HIGH");

        const medium = items.find((i) => i.externalId === "CVE-2026-RF003")!;
        expect(medium.severity).toBe("MEDIUM");
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => jsonResponse(res, 200, {
        data: {
          results: [
            {
              entity: { id: "url:cve-2026-rf001", name: "CVE-2026-RF001", type: "CyberVulnerability" },
              risk: { score: 95, evidenceDetails: [{ rule: "Linked to exploit kit", criticality: 5 }], rules: 12 },
              intelCard: "https://app.recordedfuture.com/live/sc/entity/CVE-2026-RF001",
              timestamps: { firstSeen: "2026-05-22T00:00:00Z" },
              commonNames: ["Acme WebServer", "Acme Edge Server"],
            },
            {
              entity: { name: "CVE-2026-RF002" },
              risk: { score: 75, rules: 4 },
              intelCard: "https://app.recordedfuture.com/live/sc/entity/CVE-2026-RF002",
              timestamps: { firstSeen: "2026-05-21T00:00:00Z" },
              commonNames: [],
            },
            {
              entity: { name: "CVE-2026-RF003" },
              risk: { score: 55, rules: 1 },
              timestamps: { firstSeen: "2026-05-20T00:00:00Z" },
            },
          ],
        },
      }),
    });
  });

  it("surfaces 401 (bad token) cleanly", async () => {
    await withMockServer(async ({ baseUrl }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch("recordedfuture-placeholder.invalid", baseUrl);
      try {
        await expect(recordedFutureSource.fetch()).rejects.toThrow(/Recorded Future.*401/);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => jsonResponse(res, 401, { error: "invalid token" }),
    });
  });
});

// ─── CrowdStrike ─────────────────────────────────────────────────────

describe("CrowdStrike integration", () => {
  it("OAuth's then queries /intel/combined/vulnerabilities/v1 with FQL filter", async () => {
    _resetCrowdstrikeTokenCache();
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch("crowdstrike-placeholder.invalid", baseUrl);
      try {
        const items = await crowdstrikeSource.fetch();
        expect(items.length).toBe(2);

        const tokenReq = requests.find((r) => r.url === "/oauth2/token")!;
        expect(tokenReq.method).toBe("POST");
        expect(tokenReq.headers["content-type"]).toMatch(/x-www-form-urlencoded/);
        // Body should carry client_id + client_secret.
        expect(tokenReq.body).toContain("client_id=cs-client-fake");
        expect(tokenReq.body).toContain("client_secret=cs-secret-fake");

        const vulnReq = requests.find((r) => r.url.startsWith("/intel/combined/vulnerabilities/v1"))!;
        expect(vulnReq.headers.authorization).toBe("Bearer cs-bearer-test");
        expect(vulnReq.url).toContain("filter=published_date");
        expect(vulnReq.url).toContain("sort=published_date.desc");

        // The in-the-wild one is auto-promoted to CRITICAL.
        const itw = items.find((i) => i.externalId === "CVE-2026-CS001")!;
        expect(itw.severity).toBe("CRITICAL");
        expect(itw.description).toMatch(/Exploited in the wild/);
        expect(itw.description).toMatch(/Linked actors: FANCY BEAR/);

        // The non-exploited one falls back to CVSS-derived severity.
        const normal = items.find((i) => i.externalId === "CVE-2026-CS002")!;
        expect(normal.severity).toBe("MEDIUM"); // CVSS 5.5
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (req, res) => {
        if (req.method === "POST" && req.url === "/oauth2/token") {
          jsonResponse(res, 200, { access_token: "cs-bearer-test", expires_in: 1800, token_type: "Bearer" });
          return;
        }
        if (req.url.startsWith("/intel/combined/vulnerabilities/v1")) {
          jsonResponse(res, 200, {
            meta: { pagination: { total: 2, offset: 0, limit: 100 } },
            resources: [
              {
                cve: {
                  id: "CVE-2026-CS001",
                  description: "Falcon-reported RCE.",
                  severity: "CRITICAL",
                  base_score: 9.8,
                  references: [{ url: "https://falcon.crowdstrike.com/intel/CVE-2026-CS001" }],
                },
                vendor: { name: "Acme" }, product: { name: "WebServer" },
                actors: [{ name: "FANCY BEAR" }],
                published_date: "2026-05-22T00:00:00Z",
                exploit_status: "WIDESPREAD",
                exploited_in_wild: true,
              },
              {
                cve: {
                  id: "CVE-2026-CS002",
                  description: "Information disclosure.",
                  severity: "MEDIUM",
                  base_score: 5.5,
                  references: [],
                },
                vendor: { name: "Globex" }, product: { name: "Mail" },
                published_date: "2026-05-21T00:00:00Z",
                exploited_in_wild: false,
              },
            ],
            errors: [],
          });
          return;
        }
        jsonResponse(res, 404, {});
      },
    });
  });
});
