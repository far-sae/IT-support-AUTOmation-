import { describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { bus } = await import("./bus.js");
import type { EventSink, RelayEvent } from "./bus.js";

describe("EventBus", () => {
  it("delivers events to type-specific handlers", async () => {
    const handler = vi.fn();
    bus.on("ticket.created", handler);
    bus.emit({
      kind: "ticket.created", organizationId: "org_A", ticketId: "t1",
      refCode: "INC-1", priority: "Medium", category: "Software",
    });
    // node EventEmitter is sync; handlers complete inside emit().
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ kind: "ticket.created", ticketId: "t1" });
  });

  it("doesn't deliver events of a different kind to the wrong handler", () => {
    const created = vi.fn();
    const resolved = vi.fn();
    bus.on("ticket.created", created);
    bus.on("ticket.resolved", resolved);
    bus.emit({
      kind: "ticket.resolved", organizationId: "org_A", ticketId: "t1",
      refCode: "INC-1", durationMinutes: 30, resolvedByRunbook: "password_reset",
    });
    expect(created).not.toHaveBeenCalled();
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it("forwards events to registered sinks, swallowing sink errors", async () => {
    const good: EventSink = { name: "good", publish: vi.fn().mockResolvedValue(undefined) };
    const bad:  EventSink = { name: "bad",  publish: vi.fn().mockRejectedValue(new Error("boom")) };
    bus.registerSink(good);
    bus.registerSink(bad);

    const ev: RelayEvent = {
      kind: "detection.hit", organizationId: "org_A", ruleKey: "test",
      severity: "LOW", count: 1, evidence: {},
    };
    expect(() => bus.emit(ev)).not.toThrow();
    // Sinks fired asynchronously; wait one tick for the catch handlers to settle.
    await new Promise((resolve) => setImmediate(resolve));
    expect(good.publish).toHaveBeenCalledWith(ev);
    expect(bad.publish).toHaveBeenCalledWith(ev);
  });
});
