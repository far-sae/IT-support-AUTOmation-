import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.FIREWALL_API_TOKEN = "fake-firewall-token";

const { pushFirewallBlock } = await import("./firewall.js");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { delete (global as { fetch?: typeof fetch }).fetch; });

describe("pushFirewallBlock", () => {
  it("PaloAlto: posts to the external-list refresh URL with bearer auth", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" } as Response);
    const r = await pushFirewallBlock({
      vendor: "palo_alto", baseUrl: "https://fw.acme.io",
      blockList: "relay-block", ip: "203.0.113.45",
    });
    expect(r.ok).toBe(true);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("relay-block");
    expect(url).toContain("fake-firewall-token");
  });

  it("pfSense: posts to /api/v1/firewall/alias/entry", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" } as Response);
    const r = await pushFirewallBlock({
      vendor: "pfsense", baseUrl: "https://pf.acme.io",
      ip: "198.51.100.7",
    });
    expect(r.ok).toBe(true);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://pf.acme.io/api/v1/firewall/alias/entry");
    const body = JSON.parse(call[1].body as string) as { address: string; enabled: boolean };
    expect(body.address).toBe("198.51.100.7");
    expect(body.enabled).toBe(true);
  });

  it("Generic: posts to /block with {ip, action}", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" } as Response);
    const r = await pushFirewallBlock({
      vendor: "generic", baseUrl: "https://api.fw.io",
      ip: "192.0.2.99",
    });
    expect(r.ok).toBe(true);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://api.fw.io/block");
    const body = JSON.parse(call[1].body as string) as { action: string };
    expect(body.action).toBe("BLOCK");
  });

  it("UNBLOCK flips enabled=false on pfSense", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" } as Response);
    await pushFirewallBlock({
      vendor: "pfsense", baseUrl: "https://pf.acme.io",
      ip: "198.51.100.7", action: "UNBLOCK",
    });
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  it("returns ok=false on HTTP failure", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "down" } as Response);
    const r = await pushFirewallBlock({
      vendor: "generic", baseUrl: "https://api.fw.io", ip: "192.0.2.99",
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(503);
  });
});
