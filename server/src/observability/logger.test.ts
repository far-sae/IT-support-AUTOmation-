import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.LOG_LEVEL = "debug";

const { log, registerLogSink, sinkCount } = await import("./logger.js");
import type { LogSink, LogRecord } from "./logger.js";

let originalWrite: typeof process.stdout.write;
let lines: string[];

beforeEach(() => {
  lines = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
});
afterEach(() => {
  process.stdout.write = originalWrite;
});

describe("log", () => {
  it("writes one JSON line per call to stdout", () => {
    log.info("hello", { foo: 1 });
    const parsed = JSON.parse(lines[lines.length - 1] ?? "{}") as LogRecord;
    expect(parsed.msg).toBe("hello");
    expect(parsed.level).toBe("info");
    expect(parsed.foo).toBe(1);
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("error() flattens an Error into errorMessage + errorStack", () => {
    const err = new Error("kaboom");
    log.error("brain crashed", err, { ticketId: "t1" });
    const parsed = JSON.parse(lines[lines.length - 1] ?? "{}") as LogRecord;
    expect(parsed.errorMessage).toBe("kaboom");
    expect(parsed.errorStack).toBeTypeOf("string");
    expect(parsed.ticketId).toBe("t1");
  });

  it("respects LOG_LEVEL — debug is shown when LOG_LEVEL=debug", () => {
    log.debug("verbose");
    expect(lines.find((l) => l.includes(`"msg":"verbose"`))).toBeDefined();
  });
});

describe("registerLogSink", () => {
  it("publishes each record to every registered sink", async () => {
    const before = sinkCount();
    const captured: LogRecord[] = [];
    const sink: LogSink = {
      name: "test-sink-1",
      publish: async (rec) => { captured.push(rec); },
    };
    registerLogSink(sink);
    expect(sinkCount()).toBe(before + 1);
    log.info("to-sink", { kind: "x" });
    // sink runs async; wait one tick.
    await new Promise((r) => setImmediate(r));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.msg).toBe("to-sink");
  });

  it("swallows sink errors without breaking the caller", async () => {
    const bad: LogSink = {
      name: "throws",
      publish: vi.fn().mockRejectedValue(new Error("upstream down")),
    };
    registerLogSink(bad);
    expect(() => log.info("ok")).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
