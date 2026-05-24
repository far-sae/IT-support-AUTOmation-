import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.SPLUNK_HEC_URL = "https://splunk.relay.io:8088";
process.env.SPLUNK_HEC_TOKEN = "abc-token";
process.env.SPLUNK_HEC_INDEX = "relay";

const { splunkSink } = await import("./splunk.js");
import type { LogRecord } from "../logger.js";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { delete (global as { fetch?: typeof fetch }).fetch; });

const REC: LogRecord = {
  ts: "2026-05-22T14:23:45.000Z",
  level: "info",
  service: "relay-server",
  msg: "ticket created",
  ticketId: "t1",
};

describe("splunkSink", () => {
  it("POSTs to /services/collector/event with Splunk auth + correct envelope", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "ok" } as Response);
    await splunkSink.publish(REC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("https://splunk.relay.io:8088/services/collector/event");
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Splunk abc-token");
    const body = JSON.parse(call[1].body as string) as { event: LogRecord; index?: string; time: number };
    expect(body.event.msg).toBe("ticket created");
    expect(body.index).toBe("relay");
    expect(body.time).toBe(new Date(REC.ts).getTime() / 1000);
  });

  it("throws on non-2xx so the parent fans the error to its own error path", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "bad token" } as Response);
    await expect(splunkSink.publish(REC)).rejects.toThrow(/Splunk HEC 401/);
  });
});
