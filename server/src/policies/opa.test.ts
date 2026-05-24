import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.OPA_URL = "http://opa:8181";
process.env.OPA_DECISION_PATH = "relay/allow";

const { consultOpa, opaEnabled } = await import("./opa.js");
import type { PolicyContext } from "./types.js";

const ctx: PolicyContext = {
  ticket: {
    id: "t1", organizationId: "org_A", refCode: "INC-1",
    description: "x", category: "Software", priority: "Medium",
    submitterEmail: "u@x.io", submitterName: "u", submitterUserId: null,
    assignedAgentId: null, source: "PORTAL", assignedTeam: "—",
    slaTarget: "1 day", slaDueAt: new Date(), slaAlertedAt: null,
    confidence: 0.5, status: "OPEN", autoReply: "",
    resolvedAt: null, createdAt: new Date(), updatedAt: new Date(),
  } as PolicyContext["ticket"],
  runbook: { key: "password_reset", risk: "LOW", name: "x", description: "y",
    match: () => ({ confidence: 0.8, reason: "" }),
    execute: async () => ({ status: "SUCCEEDED", publicComment: "", decision: {} }),
  } as PolicyContext["runbook"],
  risk: { score: 25, reasons: [] },
  settings: {},
  recentRunbookCount: 0,
  now: new Date("2026-05-22T14:00:00Z"),
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { delete (global as { fetch?: typeof fetch }).fetch; });

describe("opaEnabled", () => {
  it("true when OPA_URL is set", () => {
    expect(opaEnabled()).toBe(true);
  });
});

describe("consultOpa", () => {
  it("POSTs the right URL with the input envelope", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ result: true }),
    } as Response);
    const v = await consultOpa(ctx);
    expect(v.decision).toBe("ALLOW");
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("http://opa:8181/v1/data/relay/allow");
    const body = JSON.parse(call[1].body as string) as { input: { runbook: { key: string } } };
    expect(body.input.runbook.key).toBe("password_reset");
  });

  it("translates result=false → DENY", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ result: false }),
    } as Response);
    const v = await consultOpa(ctx);
    expect(v.decision).toBe("DENY");
  });

  it("honours result.allow=false with reason + escalate", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ result: { allow: false, reason: "in change-freeze window", escalate: true } }),
    } as Response);
    const v = await consultOpa(ctx);
    expect(v.decision).toBe("DENY");
    if (v.decision === "DENY") {
      expect(v.reason).toMatch(/change-freeze/);
      expect(v.escalate).toBe(true);
    }
  });

  it("fails OPEN on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({}),
    } as Response);
    const v = await consultOpa(ctx);
    expect(v.decision).toBe("ALLOW");
  });

  it("fails OPEN on network throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const v = await consultOpa(ctx);
    expect(v.decision).toBe("ALLOW");
  });

  it("fails OPEN on unknown response shape", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ result: { confused: true } }),
    } as Response);
    const v = await consultOpa(ctx);
    expect(v.decision).toBe("ALLOW");
  });

  it("treats missing result as ALLOW (no Rego rule matched)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({}),
    } as Response);
    const v = await consultOpa(ctx);
    expect(v.decision).toBe("ALLOW");
  });
});
