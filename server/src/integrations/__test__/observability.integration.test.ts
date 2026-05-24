/**
 * Phase 18 — Splunk HEC + Azure Monitor integration tests against vendor-faithful
 * mocks.
 */

import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { jsonResponse, textResponse, withMockServer } from "./mock-server.js";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.SPLUNK_HEC_TOKEN = "splunk-token-fake";
process.env.SPLUNK_HEC_INDEX = "relay";
// The actual URL never matters for the test — we retarget fetch — but must
// be truthy so the sink doesn't self-skip.
process.env.SPLUNK_HEC_URL = "http://splunk-placeholder.invalid";
process.env.AZURE_MONITOR_WORKSPACE_ID = "ws-fake-12345";
process.env.AZURE_MONITOR_SHARED_KEY = Buffer.from("the-shared-key-bytes!").toString("base64");
process.env.AZURE_MONITOR_LOG_TYPE = "RelayServer";

import type { LogRecord } from "../../observability/logger.js";

const REC: LogRecord = {
  ts: "2026-05-22T14:23:45.000Z", level: "info",
  service: "relay-server", msg: "ticket created", ticketId: "t1",
};

describe("Splunk HEC integration", () => {
  // Retarget the splunk URL to the per-test mock by swapping global.fetch.
  // env.ts caches process.env at import-time so changing SPLUNK_HEC_URL
  // mid-test doesn't propagate to the sink.
  function retargetFetch(mockBaseUrl: string): typeof fetch {
    const real = global.fetch;
    return (async (url: string | URL, init?: RequestInit) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.includes("splunk-placeholder.invalid")) {
        const path = new URL(s).pathname + new URL(s).search;
        return real(`${mockBaseUrl}${path}`, init);
      }
      return real(url, init);
    }) as typeof fetch;
  }

  it("posts the documented envelope with `Splunk <token>` auth", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const { splunkSink } = await import("../../observability/sinks/splunk.js");
        await splunkSink.publish(REC);
      } finally {
        global.fetch = realFetch;
      }

      const req = requests[0]!;
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/services/collector/event");
      expect(req.headers.authorization).toBe("Splunk splunk-token-fake");
      expect(req.headers["content-type"]).toMatch(/application\/json/);
      const body = req.parsedBody as {
        event: LogRecord; sourcetype: string; index?: string;
        host: string; time: number;
      };
      expect(body.event.msg).toBe("ticket created");
      expect(body.event.ticketId).toBe("t1");
      expect(body.sourcetype).toBe("relay:log");
      expect(body.index).toBe("relay");
      expect(body.time).toBe(new Date(REC.ts).getTime() / 1000);
      expect(typeof body.host).toBe("string");
    }, {
      handler: (req, res) => {
        if (req.url === "/services/collector/event" && req.method === "POST") {
          jsonResponse(res, 200, { text: "Success", code: 0 });
          return;
        }
        jsonResponse(res, 404, { text: "not found" });
      },
    });
  });

  it("throws on 401 (so the parent logger's fan-out sees the failure)", async () => {
    await withMockServer(async ({ baseUrl }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const { splunkSink } = await import("../../observability/sinks/splunk.js");
        await expect(splunkSink.publish(REC)).rejects.toThrow(/Splunk HEC 401/);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => jsonResponse(res, 401, { text: "Invalid token", code: 4 }),
    });
  });
});

describe("Azure Monitor Data Collector integration", () => {
  let realFetch: typeof fetch;
  beforeAll(() => { realFetch = global.fetch; });

  function retargetFetch(mockBaseUrl: string): typeof fetch {
    return (async (url: string | URL, init?: RequestInit) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.includes("ods.opinsights.azure.com")) {
        return realFetch(`${mockBaseUrl}/api/logs?api-version=2016-04-01`, init);
      }
      return realFetch(url, init);
    }) as typeof fetch;
  }

  it("posts the documented envelope with SharedKey auth + x-ms-date + Log-Type", async () => {
    await withMockServer(async ({ baseUrl, requests }) => {
      global.fetch = retargetFetch(baseUrl);
      try {
        const { azureMonitorSink } = await import("../../observability/sinks/azure_monitor.js");
        await azureMonitorSink.publish(REC);

        const req = requests[0]!;
        expect(req.method).toBe("POST");
        expect(req.url).toBe("/api/logs?api-version=2016-04-01");
        expect(req.headers.authorization).toMatch(/^SharedKey ws-fake-12345:[A-Za-z0-9+/=]+$/);
        expect(req.headers["log-type"]).toBe("RelayServer");
        expect(req.headers["x-ms-date"]).toBeTypeOf("string");
        const body = req.parsedBody as LogRecord[];
        expect(Array.isArray(body)).toBe(true);
        expect(body[0]?.ticketId).toBe("t1");

        // Recompute the HMAC and confirm it matches what was sent.
        const sharedKey = process.env.AZURE_MONITOR_SHARED_KEY!;
        const contentLength = Buffer.byteLength(req.body, "utf-8");
        const stringToHash = `POST\n${contentLength}\napplication/json\nx-ms-date:${req.headers["x-ms-date"]}\n/api/logs`;
        const expectedSig = crypto
          .createHmac("sha256", Buffer.from(sharedKey, "base64"))
          .update(stringToHash, "utf-8").digest("base64");
        expect(req.headers.authorization).toBe(`SharedKey ws-fake-12345:${expectedSig}`);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => textResponse(res, 200, ""),
    });
  });

  it("throws on 403 (invalid signature scenario)", async () => {
    await withMockServer(async ({ baseUrl }) => {
      global.fetch = retargetFetch(baseUrl);
      try {
        const { azureMonitorSink } = await import("../../observability/sinks/azure_monitor.js");
        await expect(azureMonitorSink.publish(REC)).rejects.toThrow(/Azure Monitor 403/);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => textResponse(res, 403, "Forbidden — invalid signature"),
    });
  });
});
