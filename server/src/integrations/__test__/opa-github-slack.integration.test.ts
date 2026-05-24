/**
 * Phase 18 — OPA + GitHub + Slack integration tests against vendor-faithful
 * mocks. Real HTTP against an in-process mock server.
 */

import { describe, expect, it } from "vitest";
import { jsonResponse, textResponse, withMockServer } from "./mock-server.js";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.GITHUB_TOKEN = "ghp_fake_pat";
// env.ts caches process.env at import time. The actual URL doesn't matter —
// we retarget via global.fetch — but it must be truthy so opa.ts doesn't
// self-skip with `if (!baseUrl) return ALLOW`.
process.env.OPA_URL = "http://opa-placeholder.invalid";
process.env.OPA_DECISION_PATH = "relay/allow";

const { dispatchWorkflow } = await import("../github.js");
const { consultOpa } = await import("../../policies/opa.js");
const { notifySlack } = await import("../../notifications/slack.js");
const dbMod = (await import("../../db.js")) as unknown as {
  basePrismaUnscoped: { organization: { findUnique: (a: unknown) => Promise<unknown> } };
};

import type { PolicyContext } from "../../policies/types.js";

function makePolicyCtx(): PolicyContext {
  return {
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
}

describe("OPA integration", () => {
  function retargetFetch(mockBaseUrl: string): typeof fetch {
    const real = global.fetch;
    return (async (url: string | URL, init?: RequestInit) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.includes("opa-placeholder.invalid")) {
        const u = new URL(s);
        return real(`${mockBaseUrl}${u.pathname}${u.search}`, init);
      }
      return real(url, init);
    }) as typeof fetch;
  }

  it("posts { input } envelope to /v1/data/relay/allow and parses object result with DENY", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const v = await consultOpa(makePolicyCtx());
        expect(v.decision).toBe("DENY");
        if (v.decision === "DENY") {
          expect(v.reason).toMatch(/matched test fixture/);
          expect(v.escalate).toBe(true);
        }
      } finally {
        global.fetch = realFetch;
      }

      const req = requests[0]!;
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/v1/data/relay/allow");
      expect(req.headers["content-type"]).toMatch(/application\/json/);
      const body = req.parsedBody as { input: { runbook: { key: string }; ticket: { refCode: string } } };
      expect(body.input.runbook.key).toBe("password_reset");
      expect(body.input.ticket.refCode).toBe("INC-1");
    }, {
      handler: (req, res) => {
        if (req.url === "/v1/data/relay/allow" && req.method === "POST") {
          jsonResponse(res, 200, { result: { allow: false, reason: "matched test fixture", escalate: true } });
          return;
        }
        jsonResponse(res, 404, { code: "not_found" });
      },
    });
  });

  it("fail-open ALLOW when OPA returns 500", async () => {
    await withMockServer(async ({ baseUrl }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const v = await consultOpa(makePolicyCtx());
        expect(v.decision).toBe("ALLOW");
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => jsonResponse(res, 500, { code: "internal_error" }),
    });
  });

  it("fail-open ALLOW on unreachable OPA host", async () => {
    // Retarget to a dead port — must look like opa-placeholder so retargetFetch picks it up.
    const realFetch = global.fetch;
    global.fetch = (async (url: string | URL, init?: RequestInit) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.includes("opa-placeholder.invalid")) {
        return realFetch("http://127.0.0.1:1", init);
      }
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      const v = await consultOpa(makePolicyCtx());
      expect(v.decision).toBe("ALLOW");
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe("GitHub Actions integration", () => {
  // github.ts hard-codes api.github.com — swap fetch to retarget to the mock.
  function retargetFetch(mockBaseUrl: string): typeof fetch {
    const real = global.fetch;
    return (async (url: string | URL, init?: RequestInit) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.startsWith("https://api.github.com")) {
        return real(s.replace("https://api.github.com", mockBaseUrl), init);
      }
      return real(url, init);
    }) as typeof fetch;
  }

  it("end-to-end: POST workflow_dispatch with Bearer + GitHub version header, 204 on success", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const r = await dispatchWorkflow({
          owner: "acme", repo: "relay-runbooks", workflowFile: "relay-action.yml",
          ref: "main", inputs: { ticket: "INC-1042" },
        });
        expect(r.ok).toBe(true);
        expect(r.statusCode).toBe(204);

        const req = requests[0]!;
        expect(req.method).toBe("POST");
        expect(req.url).toBe("/repos/acme/relay-runbooks/actions/workflows/relay-action.yml/dispatches");
        expect(req.headers.authorization).toBe("Bearer ghp_fake_pat");
        expect(req.headers.accept).toMatch(/vnd\.github\+json/);
        expect(req.headers["x-github-api-version"]).toBe("2022-11-28");
        const body = req.parsedBody as { ref: string; inputs: { ticket: string } };
        expect(body.ref).toBe("main");
        expect(body.inputs.ticket).toBe("INC-1042");
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => { res.writeHead(204); res.end(); },
    });
  });

  it("422 from GitHub maps to ok=false with the validation error in output", async () => {
    await withMockServer(async ({ baseUrl }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const r = await dispatchWorkflow({
          owner: "acme", repo: "relay-runbooks", workflowFile: "relay-action.yml",
        });
        expect(r.ok).toBe(false);
        expect(r.statusCode).toBe(422);
        expect(r.output).toMatch(/Validation Failed/);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => jsonResponse(res, 422, { message: "Validation Failed", documentation_url: "https://docs.github.com/..." }),
    });
  });
});

describe("Slack incoming webhook integration", () => {
  it("posts the chat envelope and accepts the 'ok' plain-text response", async () => {
    process.env.SLACK_WEBHOOK_URL = "";
    await withMockServer(async ({ baseUrl, requests }) => {
      const orig = dbMod.basePrismaUnscoped.organization.findUnique;
      dbMod.basePrismaUnscoped.organization.findUnique =
        (async () => ({ settings: { slackWebhookUrl: baseUrl } })) as unknown as typeof orig;
      try {
        const r = await notifySlack("org_A", { text: "Hello from Relay" });
        expect(r.delivered).toBe(true);

        const req = requests[0]!;
        expect(req.method).toBe("POST");
        expect(req.headers["content-type"]).toMatch(/application\/json/);
        const body = req.parsedBody as { text: string };
        expect(body.text).toBe("Hello from Relay");
      } finally {
        dbMod.basePrismaUnscoped.organization.findUnique = orig;
      }
    }, {
      handler: (_req, res) => textResponse(res, 200, "ok"),
    });
  });

  it("returns delivered=false when the webhook is rejected", async () => {
    await withMockServer(async ({ baseUrl }) => {
      const orig = dbMod.basePrismaUnscoped.organization.findUnique;
      dbMod.basePrismaUnscoped.organization.findUnique =
        (async () => ({ settings: { slackWebhookUrl: baseUrl } })) as unknown as typeof orig;
      try {
        const r = await notifySlack("org_A", { text: "Hi" });
        expect(r.delivered).toBe(false);
        expect(r.reason).toMatch(/403/);
      } finally {
        dbMod.basePrismaUnscoped.organization.findUnique = orig;
      }
    }, {
      handler: (_req, res) => textResponse(res, 403, "invalid_token"),
    });
  });
});
