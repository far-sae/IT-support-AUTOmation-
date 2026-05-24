import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.AZURE_MONITOR_WORKSPACE_ID = "ws-fake-12345";
// 32 bytes Base64 = something that decodes to 24 bytes; any valid Base64 works.
process.env.AZURE_MONITOR_SHARED_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.AZURE_MONITOR_LOG_TYPE = "RelayServer";

const { azureMonitorSink, _internal } = await import("./azure_monitor.js");
import type { LogRecord } from "../logger.js";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { delete (global as { fetch?: typeof fetch }).fetch; });

const REC: LogRecord = {
  ts: "2026-05-22T14:23:45.000Z", level: "info",
  service: "relay-server", msg: "ticket resolved", ticketId: "t1",
};

describe("buildSignature", () => {
  it("produces a stable Base64 string for the same inputs", () => {
    const sig1 = _internal.buildSignature({
      sharedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      contentLength: 100, rfc1123Date: "Fri, 22 May 2026 14:23:45 GMT",
    });
    const sig2 = _internal.buildSignature({
      sharedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      contentLength: 100, rfc1123Date: "Fri, 22 May 2026 14:23:45 GMT",
    });
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[A-Za-z0-9+/]+=*$/); // Base64
  });

  it("changes when content length changes", () => {
    const sig1 = _internal.buildSignature({
      sharedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      contentLength: 100, rfc1123Date: "Fri, 22 May 2026 14:23:45 GMT",
    });
    const sig2 = _internal.buildSignature({
      sharedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      contentLength: 200, rfc1123Date: "Fri, 22 May 2026 14:23:45 GMT",
    });
    expect(sig1).not.toBe(sig2);
  });
});

describe("azureMonitorSink", () => {
  it("POSTs to the workspace endpoint with SharedKey auth + Log-Type", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" } as Response);
    await azureMonitorSink.publish(REC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://ws-fake-12345.ods.opinsights.azure.com/api/logs?api-version=2016-04-01");
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^SharedKey ws-fake-12345:/);
    expect(headers["Log-Type"]).toBe("RelayServer");
    expect(headers["x-ms-date"]).toBeTypeOf("string");
    // Body is an array (Azure expects multi-record posts even for one record).
    const body = JSON.parse(call[1].body as string) as LogRecord[];
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]?.ticketId).toBe("t1");
  });

  it("throws on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "forbidden" } as Response);
    await expect(azureMonitorSink.publish(REC)).rejects.toThrow(/Azure Monitor 403/);
  });
});
