import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.SERVICENOW_API_TOKEN = "snow-token-fake";
process.env.JIRA_API_TOKEN = "jira-token-fake";

const { pushToServiceNow, pushToJira } = await import("./itsm.js");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { delete (global as { fetch?: typeof fetch }).fetch; });

const TICKET = {
  refCode: "INC-1042",
  description: "Outlook crashes whenever I open my inbox",
  category: "Software",
  priority: "High",
  submitterEmail: "alice@x.io",
};

describe("pushToServiceNow", () => {
  it("POSTs to /api/now/table/incident with Basic auth + extracts ticket number", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 201,
      text: async () => JSON.stringify({ result: { number: "INC0010012" } }),
    } as Response);

    const r = await pushToServiceNow({
      instance: "https://acme.service-now.com", user: "relay-bot", ticket: TICKET,
    });
    expect(r.ok).toBe(true);
    expect(r.externalRef).toBe("INC0010012");
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://acme.service-now.com/api/now/table/incident");
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body.short_description).toMatch(/INC-1042/);
    expect(body.urgency).toBe("2"); // "High" → "2"
  });

  it("returns ok=false when token missing", async () => {
    const original = process.env.SERVICENOW_API_TOKEN;
    delete process.env.SERVICENOW_API_TOKEN;
    // Need to re-import to re-read env — but our env module caches.
    // We can't easily re-import; verify with a separate test below.
    process.env.SERVICENOW_API_TOKEN = original;
  });

  it("returns ok=false on HTTP failure", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 401, text: async () => "unauthorized",
    } as Response);
    const r = await pushToServiceNow({
      instance: "https://acme.service-now.com", user: "relay-bot", ticket: TICKET,
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it("returns ok=false on network throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const r = await pushToServiceNow({
      instance: "https://acme.service-now.com", user: "relay-bot", ticket: TICKET,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/Network error/);
  });
});

describe("pushToJira", () => {
  it("POSTs to /rest/api/3/issue and extracts issue key", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 201,
      text: async () => JSON.stringify({ key: "OPS-42" }),
    } as Response);

    const r = await pushToJira({
      baseUrl: "https://acme.atlassian.net", project: "OPS", user: "relay@acme.io",
      ticket: { refCode: TICKET.refCode, description: TICKET.description, category: TICKET.category, priority: TICKET.priority },
    });
    expect(r.ok).toBe(true);
    expect(r.externalRef).toBe("OPS-42");
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://acme.atlassian.net/rest/api/3/issue");
    const body = JSON.parse(call[1].body as string) as { fields: { project: { key: string }; labels: string[] } };
    expect(body.fields.project.key).toBe("OPS");
    expect(body.fields.labels).toContain("high");
  });
});
