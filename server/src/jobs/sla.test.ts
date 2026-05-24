import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const ticketFindMany = vi.fn();
const ticketUpdate = vi.fn();
const emitFn = vi.fn();
const sendMailFn = vi.fn();

vi.mock("../db.js", () => ({
  basePrismaUnscoped: {
    ticket: {
      findMany: (a: unknown) => ticketFindMany(a),
      update: (a: unknown) => ticketUpdate(a),
    },
  },
  prisma: {},
}));

vi.mock("../tenant/context.js", () => ({
  // Inline the callback so the test doesn't need real ALS.
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

vi.mock("../realtime/socket.js", () => ({
  emit: (event: string, payload: unknown) => emitFn(event, payload),
}));

vi.mock("../email/mailer.js", () => ({
  sendMail: (args: unknown) => sendMailFn(args),
}));

vi.mock("../notifications/slack.js", () => ({
  notifySlackBreach: vi.fn().mockResolvedValue(undefined),
  notifySlack: vi.fn().mockResolvedValue(undefined),
  notifySlackBrief: vi.fn().mockResolvedValue(undefined),
}));

const { scanAndAlertBreaches } = await import("./sla.js");

beforeEach(() => {
  ticketFindMany.mockReset();
  ticketUpdate.mockReset();
  emitFn.mockReset();
  sendMailFn.mockReset();
});

describe("scanAndAlertBreaches", () => {
  const NOW = new Date("2026-05-22T12:00:00Z");

  it("queries OPEN/IN_PROGRESS tickets that are past slaDueAt and not yet alerted", async () => {
    ticketFindMany.mockResolvedValueOnce([]);
    await scanAndAlertBreaches(NOW);
    expect(ticketFindMany).toHaveBeenCalledTimes(1);
    const args = ticketFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({
      status: { not: "RESOLVED" },
      slaDueAt: { lte: NOW },
      slaAlertedAt: null,
    });
  });

  it("alerts each breached ticket — sets slaAlertedAt, emits sla:breach, emails the agent", async () => {
    const breached = [
      {
        id: "t1", refCode: "INC-1001", organizationId: "org_a",
        priority: "Critical", category: "Network", assignedTeam: "Network Operations",
        description: "VPN down for the whole team",
        slaDueAt: new Date(NOW.getTime() - 30 * 60_000),
        assignedAgent: { email: "agent@relay.io", name: "Sam Agent" },
      },
      {
        id: "t2", refCode: "INC-1002", organizationId: "org_b",
        priority: "High", category: "Email", assignedTeam: "Messaging Team",
        description: "Outlook syncing failing",
        slaDueAt: new Date(NOW.getTime() - 5 * 60_000),
        assignedAgent: null,
      },
    ];
    ticketFindMany.mockResolvedValueOnce(breached);
    ticketUpdate.mockResolvedValue({});
    sendMailFn.mockResolvedValue({ delivered: true });

    const result = await scanAndAlertBreaches(NOW);

    expect(result.alerted).toHaveLength(2);
    expect(result.alerted[0]).toMatchObject({ ticketId: "t1", refCode: "INC-1001", minutesOver: 30, notifiedAgent: "agent@relay.io" });
    expect(result.alerted[1]).toMatchObject({ ticketId: "t2", refCode: "INC-1002", minutesOver: 5, notifiedAgent: null });

    expect(ticketUpdate).toHaveBeenCalledTimes(2);
    expect(ticketUpdate.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "t1" },
      data: { slaAlertedAt: NOW },
    });

    // Email only sent for the ticket WITH an assigned agent.
    expect(sendMailFn).toHaveBeenCalledTimes(1);
    expect(sendMailFn.mock.calls[0]?.[0]).toMatchObject({ to: "agent@relay.io" });

    // Two sla:breach events + two analytics:updated events (one per org, since
    // each breached ticket re-enters its own tenant context before emitting).
    const events = emitFn.mock.calls.map((c) => c[0]);
    expect(events.filter((e) => e === "sla:breach")).toHaveLength(2);
    expect(events.filter((e) => e === "analytics:updated")).toHaveLength(2);
  });

  it("does nothing when no tickets are breached", async () => {
    ticketFindMany.mockResolvedValueOnce([]);
    const result = await scanAndAlertBreaches(NOW);
    expect(result.alerted).toHaveLength(0);
    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(sendMailFn).not.toHaveBeenCalled();
    expect(emitFn).not.toHaveBeenCalled();
  });

  it("still alerts even when the email transport throws (best-effort send)", async () => {
    ticketFindMany.mockResolvedValueOnce([{
      id: "t1", refCode: "INC-1001", organizationId: "org_a",
      priority: "High", category: "Network", assignedTeam: "Network Operations",
      description: "x",
      slaDueAt: new Date(NOW.getTime() - 60_000),
      assignedAgent: { email: "agent@relay.io", name: "Sam" },
    }]);
    ticketUpdate.mockResolvedValue({});
    sendMailFn.mockRejectedValueOnce(new Error("SMTP down"));

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await scanAndAlertBreaches(NOW);
    consoleError.mockRestore();

    expect(result.alerted).toHaveLength(1);
    expect(result.alerted[0]?.notifiedAgent).toBeNull(); // failed to notify
    expect(ticketUpdate).toHaveBeenCalledTimes(1);
    expect(emitFn).toHaveBeenCalledWith("sla:breach", expect.objectContaining({ ticketId: "t1" }));
  });
});
