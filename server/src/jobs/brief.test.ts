import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const orgFindUnique = vi.fn();
const orgFindMany   = vi.fn();
const userFindMany  = vi.fn();
const briefUpsert   = vi.fn();
const briefFindUnique = vi.fn();
const ticketCount   = vi.fn();
const deviceCount   = vi.fn();
const runbookCount  = vi.fn();
const runbookGroupBy = vi.fn();
const sendMail      = vi.fn().mockResolvedValue({ delivered: true });
const notifySlackBrief = vi.fn().mockResolvedValue(undefined);

vi.mock("../db.js", () => ({
  basePrismaUnscoped: {
    organization: { findUnique: orgFindUnique, findMany: orgFindMany },
    dailyBrief:   { upsert: briefUpsert, findUnique: briefFindUnique },
    user:         { findMany: userFindMany },
  },
  prisma: {
    ticket:           { count: ticketCount },
    device:           { count: deviceCount },
    runbookExecution: { count: runbookCount, groupBy: runbookGroupBy },
  },
}));
vi.mock("../email/mailer.js",         () => ({ sendMail: (a: unknown) => sendMail(a) }));
vi.mock("../notifications/slack.js",  () => ({ notifySlackBrief: (a: unknown) => notifySlackBrief(a) }));
vi.mock("../tenant/context.js",       () => ({ runWithTenant: (_orgId: string, fn: () => unknown) => fn() }));

const { generateBriefForOrg, gatherStats } = await import("./dailyBrief.js");

beforeEach(() => {
  for (const m of [orgFindUnique, orgFindMany, userFindMany, briefUpsert, briefFindUnique,
    ticketCount, deviceCount, runbookCount, runbookGroupBy, sendMail, notifySlackBrief]) m.mockReset();
  sendMail.mockResolvedValue({ delivered: true });
  notifySlackBrief.mockResolvedValue(undefined);
  briefFindUnique.mockResolvedValue(null);

  // Default counts so gatherStats doesn't undefined-explode.
  ticketCount.mockResolvedValueOnce(8);  // opened
  ticketCount.mockResolvedValueOnce(5);  // resolved
  runbookCount.mockResolvedValueOnce(4); // auto-resolved
  ticketCount.mockResolvedValueOnce(1);  // breaches
  deviceCount.mockResolvedValueOnce(2);  // critical devices
  runbookGroupBy.mockResolvedValueOnce([
    { runbookKey: "password_reset", status: "SUCCEEDED", _count: { _all: 3 } },
    { runbookKey: "password_reset", status: "FAILED",    _count: { _all: 1 } },
    { runbookKey: "restart_service", status: "SUCCEEDED", _count: { _all: 1 } },
  ]);
  runbookCount.mockResolvedValueOnce(1); // escalations
});
afterEach(() => vi.restoreAllMocks());

describe("gatherStats", () => {
  it("aggregates the prior day's numbers", async () => {
    const stats = await gatherStats("org_A", new Date("2026-05-23T08:00:00Z"));
    expect(stats.ticketsOpened).toBe(8);
    expect(stats.ticketsResolved).toBe(5);
    expect(stats.autoResolvedByBrain).toBe(4);
    expect(stats.slaBreached).toBe(1);
    expect(stats.devicesCritical).toBe(2);
    expect(stats.escalations).toBe(1);
    expect(stats.topRunbooks[0]?.key).toBe("password_reset");
    expect(stats.topRunbooks[0]?.runs).toBe(4);
    expect(stats.topRunbooks[0]?.succeeded).toBe(3);
    expect(stats.topRunbooks[0]?.failed).toBe(1);
  });
});

describe("generateBriefForOrg", () => {
  it("template-fills when AI is off, writes the row, emails admins, posts Slack", async () => {
    orgFindUnique.mockResolvedValue({ name: "Acme" });
    briefUpsert.mockResolvedValueOnce({ id: "brief_1" });
    userFindMany.mockResolvedValueOnce([{ email: "admin@relay.io", name: "A" }]);

    const r = await generateBriefForOrg({
      organizationId: "org_A", orgName: "Acme", now: new Date("2026-05-23T08:00:00Z"),
    });
    expect(r).not.toBeNull();
    expect(r!.markdown).toMatch(/Relay daily brief/);
    expect(r!.markdown).toMatch(/Acme/);
    expect(r!.markdown).toMatch(/password_reset/);
    expect(briefUpsert).toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@relay.io",
      subject: expect.stringContaining("Relay daily brief"),
    }));
    expect(notifySlackBrief).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_A", orgName: "Acme",
    }));
  });

  it("returns the existing brief without regenerating when one already exists today", async () => {
    briefFindUnique.mockResolvedValueOnce({
      id: "brief_existing",
      markdown: "# previous", stats: { ticketsOpened: 0 } as object,
    });
    const r = await generateBriefForOrg({
      organizationId: "org_A", orgName: "Acme", now: new Date("2026-05-23T08:00:00Z"),
    });
    expect(r!.briefId).toBe("brief_existing");
    expect(briefUpsert).not.toHaveBeenCalled();
  });
});
