/**
 * Phase 25 — Integration tests for the threat-intel sources.
 *
 * Each source has its real-world API contract implemented by a tiny
 * in-process HTTP server; the source's real fetch code is exercised
 * end-to-end against the mock (we retarget the URL via global.fetch
 * so env caching doesn't matter).
 */

import { describe, expect, it } from "vitest";
import { jsonResponse, withMockServer } from "../../integrations/__test__/mock-server.js";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.CISA_KEV_URL = "https://cisa-placeholder.invalid/kev.json";
process.env.NVD_API_BASE = "https://nvd-placeholder.invalid/rest/json";
process.env.NVD_API_KEY  = "test-key";

const { cisaKevSource } = await import("../sources/cisa-kev.js");
const { nvdSource }     = await import("../sources/nvd.js");

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

describe("CISA KEV ingester", () => {
  it("maps the official catalog shape into IngestedIntel rows", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch("cisa-placeholder.invalid", baseUrl);
      try {
        const items = await cisaKevSource.fetch();
        expect(items.length).toBe(2);
        expect(requests[0]?.url).toBe("/kev.json");

        const ransomware = items.find((i) => i.externalId === "CVE-2024-1111")!;
        expect(ransomware.kind).toBe("KEV");
        expect(ransomware.severity).toBe("CRITICAL");
        expect(ransomware.kevMetadata?.knownRansomwareCampaignUse).toBe(true);
        expect(ransomware.affected).toContain("Acme");
        expect(ransomware.title).toContain("CVE-2024-1111");

        const benign = items.find((i) => i.externalId === "CVE-2024-2222")!;
        expect(benign.kevMetadata?.knownRansomwareCampaignUse).toBe(false);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => jsonResponse(res, 200, {
        title: "CISA KEV Catalog", catalogVersion: "2026.05.22", dateReleased: "2026-05-22T00:00:00Z",
        count: 2,
        vulnerabilities: [
          {
            cveID: "CVE-2024-1111", vendorProject: "Acme", product: "WebServer",
            vulnerabilityName: "Unauthenticated RCE", dateAdded: "2026-05-15",
            shortDescription: "An attacker can execute arbitrary code without auth.",
            requiredAction: "Apply vendor patch v3.4.5 immediately.",
            dueDate: "2026-06-05", knownRansomwareCampaignUse: "Known", notes: "",
          },
          {
            cveID: "CVE-2024-2222", vendorProject: "Globex", product: "Mail Gateway",
            vulnerabilityName: "Path traversal", dateAdded: "2026-05-10",
            shortDescription: "Path traversal allows reading arbitrary files.",
            requiredAction: "Apply patch.", dueDate: "2026-05-31",
            knownRansomwareCampaignUse: "Unknown", notes: "",
          },
        ],
      }),
    });
  });

  it("surfaces HTTP errors clearly", async () => {
    await withMockServer(async ({ baseUrl }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch("cisa-placeholder.invalid", baseUrl);
      try {
        await expect(cisaKevSource.fetch()).rejects.toThrow(/CISA KEV HTTP 503/);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => { res.writeHead(503); res.end("upstream gateway timeout"); },
    });
  });
});

describe("NVD ingester", () => {
  it("paginates /cves/2.0 and maps fields", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch("nvd-placeholder.invalid", baseUrl);
      try {
        const items = await nvdSource.fetch();
        expect(items.length).toBe(3);
        expect(requests.some((r) => r.url.includes("/cves/2.0"))).toBe(true);

        const high = items.find((i) => i.externalId === "CVE-2026-0001")!;
        expect(high.severity).toBe("CRITICAL");
        expect(high.cvss).toBe(9.8);
        expect(high.affected).toContain("cpe:2.3:a:acme:web:1.0:*:*:*:*:*:*:*");

        const medium = items.find((i) => i.externalId === "CVE-2026-0003")!;
        expect(medium.severity).toBe("MEDIUM");
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (req, res) => {
        // req.url is the raw path+query the mock received after retarget.
        const startIndex = Number(new URL(`http://x${req.url}`).searchParams.get("startIndex") ?? "0");
        if (startIndex === 0) {
          jsonResponse(res, 200, {
            resultsPerPage: 3, startIndex: 0, totalResults: 3,
            vulnerabilities: [
              {
                cve: {
                  id: "CVE-2026-0001", published: "2026-05-22T00:00:00Z", lastModified: "2026-05-22T00:00:00Z",
                  descriptions: [{ lang: "en", value: "An attacker can fully take over." }],
                  metrics: { cvssMetricV31: [{ cvssData: { baseScore: 9.8 } }] },
                  configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: "cpe:2.3:a:acme:web:1.0:*:*:*:*:*:*:*" }] }] }],
                  references: [{ url: "https://example.com/poc" }],
                },
              },
              {
                cve: {
                  id: "CVE-2026-0002", published: "2026-05-21T00:00:00Z", lastModified: "2026-05-21T00:00:00Z",
                  descriptions: [{ lang: "en", value: "A medium-severity DoS." }],
                  metrics: { cvssMetricV31: [{ cvssData: { baseScore: 7.5 } }] },
                  configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: "cpe:2.3:a:globex:mail:2.1:*:*:*:*:*:*:*" }] }] }],
                  references: [{ url: "https://example.com/cve2" }],
                },
              },
              {
                cve: {
                  id: "CVE-2026-0003", published: "2026-05-20T00:00:00Z", lastModified: "2026-05-20T00:00:00Z",
                  descriptions: [{ lang: "en", value: "Information disclosure on the admin interface." }],
                  metrics: { cvssMetricV2: [{ cvssData: { baseScore: 5.5 } }] },
                  references: [],
                },
              },
            ],
          });
          return;
        }
        jsonResponse(res, 200, { resultsPerPage: 0, startIndex, totalResults: 3, vulnerabilities: [] });
      },
    });
  }, 10_000);
});
