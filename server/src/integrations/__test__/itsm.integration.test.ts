/**
 * Phase 18 — ServiceNow + Jira integration tests against vendor-faithful mocks.
 *
 * These exercise the SAME `pushToServiceNow` / `pushToJira` code paths that
 * run in production against a real ServiceNow instance / Atlassian Cloud,
 * but pointed at a tiny in-process HTTP server that implements the documented
 * API contract:
 *
 *   ServiceNow Table API
 *     POST /api/now/table/{table}
 *     Authorization: Basic base64(user:token)
 *     Body  → JSON record
 *     200/201 → { result: { number: "INC0010012", ... } }
 *     401 → { error: { detail: "..." } }
 *
 *   Jira REST API v3
 *     POST /rest/api/3/issue
 *     Authorization: Basic base64(email:token)
 *     Body  → { fields: { ... } }
 *     201 → { id, key: "OPS-42", self }
 *     400 → { errorMessages: [...], errors: { ... } }
 */

import { describe, expect, it } from "vitest";
import { jsonResponse, withMockServer } from "./mock-server.js";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.SERVICENOW_API_TOKEN = "snow-token-fake";
process.env.JIRA_API_TOKEN = "jira-token-fake";

const { pushToServiceNow, pushToJira } = await import("../itsm.js");

const TICKET = {
  refCode: "INC-1042",
  description: "Outlook keeps crashing whenever I open my inbox",
  category: "Software",
  priority: "High",
  submitterEmail: "alice@acme.io",
};

describe("ServiceNow integration", () => {
  it("end-to-end happy path: posts to Table API, parses ticket number from response", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const r = await pushToServiceNow({
        instance: baseUrl, user: "relay-bot", ticket: TICKET,
      });
      expect(r.ok).toBe(true);
      expect(r.statusCode).toBe(201);
      expect(r.externalRef).toBe("INC0010099");

      // Verify the request the integration actually sent.
      expect(requests).toHaveLength(1);
      const req = requests[0]!;
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/api/now/table/incident");
      expect(req.headers.authorization).toMatch(/^Basic /);
      const credBytes = Buffer.from(req.headers.authorization!.replace(/^Basic /, ""), "base64").toString("utf-8");
      expect(credBytes).toBe("relay-bot:snow-token-fake");
      expect(req.headers["content-type"]).toMatch(/application\/json/);
      const body = req.parsedBody as Record<string, unknown>;
      expect(body.short_description).toMatch(/INC-1042/);
      expect(body.description).toBe(TICKET.description);
      expect(body.urgency).toBe("2");           // High → "2"
      expect(body.caller_id).toBe(TICKET.submitterEmail);
      expect(body.external_id).toBe(TICKET.refCode);
    }, {
      handler: (req, res) => {
        if (req.url === "/api/now/table/incident" && req.method === "POST") {
          jsonResponse(res, 201, { result: { sys_id: "abc123def456", number: "INC0010099" } });
          return;
        }
        jsonResponse(res, 404, { error: { detail: "no such resource" } });
      },
    });
  });

  it("respects a custom table name", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const r = await pushToServiceNow({
        instance: baseUrl, user: "relay-bot", table: "u_security_event", ticket: TICKET,
      });
      expect(r.ok).toBe(true);
      expect(requests[0]?.url).toBe("/api/now/table/u_security_event");
    }, {
      handler: (_req, res) => jsonResponse(res, 201, { result: { number: "SEC0001" } }),
    });
  });

  it("surfaces 401 from the vendor without throwing", async () => {
    const r = await withMockServer(async ({ baseUrl }) => {
      return await pushToServiceNow({
        instance: baseUrl, user: "relay-bot", ticket: TICKET,
      });
    }, {
      handler: (_req, res) => jsonResponse(res, 401, { error: { detail: "User Not Authenticated" } }),
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(401);
    expect(r.output).toMatch(/Not Authenticated/);
    expect(r.externalRef).toBeNull();
  });

  it("returns externalRef=null when the response is malformed", async () => {
    const r = await withMockServer(async ({ baseUrl }) => {
      return await pushToServiceNow({
        instance: baseUrl, user: "relay-bot", ticket: TICKET,
      });
    }, {
      handler: (_req, res) => jsonResponse(res, 201, { result: { but_no_number_field: true } }),
    });
    expect(r.ok).toBe(true);
    expect(r.externalRef).toBeNull();
  });

  it("Critical priority → urgency=1; Medium → urgency=3", async () => {
    for (const [priority, expectedUrgency] of [["Critical", "1"], ["Medium", "3"]] as const) {
      await withMockServer(async ({ baseUrl, requests }) => {
        await pushToServiceNow({
          instance: baseUrl, user: "relay-bot",
          ticket: { ...TICKET, priority },
        });
        const body = requests.at(-1)?.parsedBody as { urgency: string };
        expect(body.urgency).toBe(expectedUrgency);
      }, {
        handler: (_req, res) => jsonResponse(res, 201, { result: { number: "INC0001" } }),
      });
    }
  });
});

describe("Jira integration", () => {
  it("end-to-end happy path: posts to /rest/api/3/issue with ADF description, parses issue key", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const r = await pushToJira({
        baseUrl, project: "OPS", user: "relay@acme.io",
        ticket: {
          refCode: TICKET.refCode, description: TICKET.description,
          category: TICKET.category, priority: TICKET.priority,
        },
      });
      expect(r.ok).toBe(true);
      expect(r.externalRef).toBe("OPS-101");

      const req = requests[0]!;
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/rest/api/3/issue");
      const credBytes = Buffer.from(req.headers.authorization!.replace(/^Basic /, ""), "base64").toString("utf-8");
      expect(credBytes).toBe("relay@acme.io:jira-token-fake");

      const body = req.parsedBody as {
        fields: {
          project: { key: string }; issuetype: { name: string };
          summary: string; description: { type: string; content: unknown[] };
          labels: string[];
        };
      };
      expect(body.fields.project.key).toBe("OPS");
      expect(body.fields.issuetype.name).toBe("Task");
      expect(body.fields.summary).toMatch(/INC-1042/);
      // Atlassian Document Format payload
      expect(body.fields.description.type).toBe("doc");
      expect(body.fields.labels).toContain("relay");
      expect(body.fields.labels).toContain("high"); // lowercased priority
    }, {
      handler: (_req, res) => jsonResponse(res, 201, {
        id: "10042", key: "OPS-101", self: "https://acme.atlassian.net/rest/api/3/issue/10042",
      }),
    });
  });

  it("respects a custom issue type", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      await pushToJira({
        baseUrl, project: "OPS", user: "relay@acme.io", issueType: "Incident",
        ticket: { refCode: "X", description: "y", category: "z", priority: "Low" },
      });
      const body = requests[0]?.parsedBody as { fields: { issuetype: { name: string } } };
      expect(body.fields.issuetype.name).toBe("Incident");
    }, {
      handler: (_req, res) => jsonResponse(res, 201, { key: "OPS-1" }),
    });
  });

  it("surfaces Jira 400 validation errors gracefully", async () => {
    const r = await withMockServer(async ({ baseUrl }) => {
      return await pushToJira({
        baseUrl, project: "BAD-PROJECT", user: "relay@acme.io",
        ticket: { refCode: "X", description: "y", category: "z", priority: "Low" },
      });
    }, {
      handler: (_req, res) => jsonResponse(res, 400, {
        errorMessages: ["project is required"],
        errors: { project: "Specify a valid project" },
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(400);
    expect(r.output).toMatch(/project/);
  });
});
