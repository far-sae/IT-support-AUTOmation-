/**
 * Phase 18 — Firewall integration tests against vendor-faithful mocks.
 *
 *   PaloAlto PAN-OS — XML API on /api/?type=op&cmd=<request>...</request>
 *                     key passed in the query string (Bearer also accepted by some PAN-OS versions)
 *                     200 → `<response status="success">...`
 *                     403 → `<response status="error">...`
 *
 *   pfSense REST API — JSON on /api/v1/firewall/alias/entry
 *                     Bearer auth; 200 with success/false/data envelope
 *
 *   Generic         — POST /block with { ip, action } and Bearer auth
 */

import { describe, expect, it } from "vitest";
import { jsonResponse, textResponse, withMockServer } from "./mock-server.js";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.FIREWALL_API_TOKEN = "fw-token-fake";

const { pushFirewallBlock } = await import("../firewall.js");

describe("PaloAlto integration", () => {
  it("posts the EDL refresh URL and includes the key in the query string", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const r = await pushFirewallBlock({
        vendor: "palo_alto", baseUrl, blockList: "relay-block",
        ip: "203.0.113.45", action: "BLOCK",
      });
      expect(r.ok).toBe(true);
      expect(r.statusCode).toBe(200);
      // PaloAlto returns XML — we keep the raw body for the audit log.
      expect(r.output).toMatch(/status="success"/);

      const req = requests[0]!;
      expect(req.method).toBe("POST");
      expect(req.url).toMatch(/^\/api\/\?type=op&cmd=/);
      expect(req.url).toContain("relay-block");
      // Token MUST be in the query string per PAN-OS XML API conventions.
      expect(req.url).toContain("fw-token-fake");
    }, {
      handler: (_req, res) => textResponse(res, 200,
        `<response status="success"><result><msg>EDL refresh queued</msg></result></response>`),
    });
  });

  it("falls back to the default 'relay-block' EDL when blockList is omitted", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      await pushFirewallBlock({
        vendor: "palo_alto", baseUrl, ip: "203.0.113.45",
      });
      expect(requests[0]?.url).toContain("relay-block");
    }, {
      handler: (_req, res) => textResponse(res, 200, `<response status="success"/>`),
    });
  });

  it("surfaces a PAN-OS 403 cleanly", async () => {
    const r = await withMockServer(async ({ baseUrl }) => {
      return await pushFirewallBlock({
        vendor: "palo_alto", baseUrl, blockList: "x",
        ip: "203.0.113.45",
      });
    }, {
      handler: (_req, res) => textResponse(res, 403,
        `<response status="error"><msg>Invalid credential</msg></response>`),
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(403);
    expect(r.output).toMatch(/Invalid credential/);
  });
});

describe("pfSense integration", () => {
  it("POSTs to /api/v1/firewall/alias/entry with Bearer + enabled=true on BLOCK", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const r = await pushFirewallBlock({
        vendor: "pfsense", baseUrl, ip: "198.51.100.7",
      });
      expect(r.ok).toBe(true);
      const req = requests[0]!;
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/api/v1/firewall/alias/entry");
      expect(req.headers.authorization).toBe("Bearer fw-token-fake");
      const body = req.parsedBody as { name: string; address: string; enabled: boolean };
      expect(body.address).toBe("198.51.100.7");
      expect(body.enabled).toBe(true);
      // pfSense default alias name when none provided
      expect(body.name).toBe("relay_block");
    }, {
      handler: (req, res) => {
        // pfSense responds with a JSON envelope
        if (req.url === "/api/v1/firewall/alias/entry") {
          jsonResponse(res, 200, { status: "ok", code: 200, return: 0, message: "Success", data: { name: "relay_block" } });
          return;
        }
        jsonResponse(res, 404, { status: "not_found" });
      },
    });
  });

  it("UNBLOCK flips enabled=false on the entry", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      await pushFirewallBlock({
        vendor: "pfsense", baseUrl, ip: "198.51.100.7", action: "UNBLOCK",
      });
      const body = requests[0]?.parsedBody as { enabled: boolean };
      expect(body.enabled).toBe(false);
    }, {
      handler: (_req, res) => jsonResponse(res, 200, { status: "ok" }),
    });
  });
});

describe("Generic firewall integration", () => {
  it("POSTs /block with { ip, action }", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const r = await pushFirewallBlock({
        vendor: "generic", baseUrl, ip: "192.0.2.99",
      });
      expect(r.ok).toBe(true);
      const req = requests[0]!;
      expect(req.url).toBe("/block");
      expect(req.headers.authorization).toBe("Bearer fw-token-fake");
      const body = req.parsedBody as { ip: string; action: string };
      expect(body).toEqual({ ip: "192.0.2.99", action: "BLOCK" });
    }, {
      handler: (_req, res) => jsonResponse(res, 204, {}),
    });
  });

  it("captures a 5xx vendor error in `output`", async () => {
    const r = await withMockServer(async ({ baseUrl }) => {
      return await pushFirewallBlock({
        vendor: "generic", baseUrl, ip: "192.0.2.99",
      });
    }, {
      handler: (_req, res) => textResponse(res, 503, "upstream gateway timeout"),
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(503);
    expect(r.output).toMatch(/gateway timeout/);
  });
});

describe("Network failure modes", () => {
  it("returns ok=false when the server connection is refused (unreachable host)", async () => {
    // Port 1 is reserved + no service binds there → ECONNREFUSED.
    const r = await pushFirewallBlock({
      vendor: "generic", baseUrl: "http://127.0.0.1:1", ip: "192.0.2.1",
    });
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/Network error/);
  });
});
