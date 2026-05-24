/**
 * Phase 26 — Defender unit tests.
 *
 * These exercise the tool implementations + the synthetic-briefing
 * path (no AI key) end-to-end against a mocked Prisma. The full Claude
 * tool-use loop is integration territory and requires an API key — we
 * leave that to live verification.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
// Make sure AI brain is off so runDefenderForOrg uses the synthetic path.
delete process.env.USE_AI_BRAIN;
delete process.env.ANTHROPIC_API_KEY;

const deviceFindMany       = vi.fn();
const intelFindMany        = vi.fn();
const intelFindUnique      = vi.fn();
const matchFindMany        = vi.fn();
const matchFindUnique      = vi.fn();
const matchUpdate          = vi.fn();
const matchCount           = vi.fn();
const hitFindMany          = vi.fn();
const ticketCreate         = vi.fn();
const ticketFindMany       = vi.fn();
const defenderUpsert       = vi.fn();
const defenderUpdate       = vi.fn();
const defenderFindFirst    = vi.fn();

vi.mock("../db.js", () => ({
  basePrismaUnscoped: {
    threatIntel: { findMany: (a: unknown) => intelFindMany(a), findUnique: (a: unknown) => intelFindUnique(a) },
    defenderRun: {
      upsert:    (a: unknown) => defenderUpsert(a),
      update:    (a: unknown) => defenderUpdate(a),
      findFirst: (a: unknown) => defenderFindFirst(a),
    },
  },
  prisma: {
    device:       { findMany: (a: unknown) => deviceFindMany(a) },
    threatMatch:  {
      findMany:   (a: unknown) => matchFindMany(a),
      findUnique: (a: unknown) => matchFindUnique(a),
      update:     (a: unknown) => matchUpdate(a),
      count:      (a: unknown) => matchCount(a),
    },
    detectionHit: { findMany: (a: unknown) => hitFindMany(a) },
    ticket:       { create:   (a: unknown) => ticketCreate(a), findMany: (a: unknown) => ticketFindMany(a) },
    defenderRun:  { findFirst: (a: unknown) => defenderFindFirst(a) },
  },
}));
vi.mock("../tenant/context.js", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

const { runDefenderForOrg } = await import("./agent.js");
const { runTool }           = await import("./tools.js");
import type { ToolCtx } from "./tools.js";

beforeEach(() => {
  for (const m of [
    deviceFindMany, intelFindMany, intelFindUnique, matchFindMany, matchFindUnique,
    matchUpdate, matchCount, hitFindMany, ticketCreate, ticketFindMany,
    defenderUpsert, defenderUpdate, defenderFindFirst,
  ]) m.mockReset();
  // Sensible defaults — everything empty.
  deviceFindMany.mockResolvedValue([]);
  intelFindMany.mockResolvedValue([]);
  matchFindMany.mockResolvedValue([]);
  hitFindMany.mockResolvedValue([]);
  defenderFindFirst.mockResolvedValue(null);
  defenderUpsert.mockResolvedValue({ id: "dr_1" });
  defenderUpdate.mockResolvedValue({});
});

describe("runDefenderForOrg — synthetic (no AI)", () => {
  it("creates a DefenderRun row + writes a templated briefing when AI is off", async () => {
    deviceFindMany.mockResolvedValueOnce([
      { os: "Windows 11", healthStatus: "HEALTHY", lastCheckInAt: new Date() },
      { os: "macOS 14",   healthStatus: "CRITICAL", lastCheckInAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    ]);
    intelFindMany.mockResolvedValueOnce([
      { id: "ti_1", kind: "KEV", severity: "CRITICAL", source: "cisa_kev",
        externalId: "CVE-2024-1", title: "Critical Windows RCE", publishedAt: new Date() },
    ]);
    matchFindMany.mockResolvedValueOnce([
      { id: "tm_1", threatIntelId: "ti_1", reason: "1 device runs windows",
        threatIntel: { externalId: "CVE-2024-1", severity: "CRITICAL", kind: "KEV", title: "x" } },
    ]);

    const r = await runDefenderForOrg("org_A", { runDate: new Date("2026-05-22T06:00:00Z") });
    expect(r.status).toBe("SUCCEEDED");
    expect(r.briefing).toMatch(/Daily defender briefing/);
    expect(r.briefing).toMatch(/Windows 11/);
    expect(r.briefing).toMatch(/CVE-2024-1/);
    // No decisions — synthetic mode doesn't take actions.
    expect(r.decisions.length).toBe(0);
  });
});

describe("tools", () => {
  function ctx(): ToolCtx {
    return {
      organizationId: "org_A",
      decisions: [],
      briefing: { markdown: "" },
      finished: { value: false },
    };
  }

  it("open_ticket_from_match creates a security ticket + records the decision", async () => {
    matchFindUnique.mockResolvedValueOnce({
      id: "tm_1", status: "OPEN", resultingTicketId: null,
      reason: "1 device runs windows",
      threatIntel: { externalId: "CVE-2024-1", severity: "CRITICAL", title: "Windows RCE", description: "details" },
    });
    ticketCreate.mockResolvedValueOnce({ id: "tk_1", refCode: "INC-9999" });
    matchUpdate.mockResolvedValueOnce({});

    const c = ctx();
    const r = await runTool("open_ticket_from_match", {
      matchId: "tm_1", priority: "Critical", reason: "active ransomware vector",
    }, c);
    expect(r).toMatchObject({ ok: true, refCode: "INC-9999" });
    expect(c.decisions).toHaveLength(1);
    expect(c.decisions[0]?.kind).toBe("open_ticket");
    // Ticket payload sanity.
    const createArgs = ticketCreate.mock.calls[0]?.[0] as { data: { category: string; submitterName: string } };
    expect(createArgs.data.category).toBe("Security");
    expect(createArgs.data.submitterName).toMatch(/defender/i);
  });

  it("dismiss_match flips status DISMISSED + records decision", async () => {
    matchUpdate.mockResolvedValueOnce({});
    const c = ctx();
    await runTool("dismiss_match", { matchId: "tm_1", reason: "n/a to our stack" }, c);
    expect(c.decisions[0]?.kind).toBe("dismiss_match");
    expect(matchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DISMISSED" }),
    }));
  });

  it("recommend_runbook rejects unknown keys + accepts real ones", async () => {
    const c = ctx();
    const bad = await runTool("recommend_runbook", {
      matchId: "tm_1", runbookKey: "make_coffee", reason: "no thanks",
    }, c);
    expect(bad).toMatchObject({ error: expect.stringContaining("unknown runbook") });
    // password_reset is a real registered runbook.
    const good = await runTool("recommend_runbook", {
      matchId: "tm_1", runbookKey: "password_reset", reason: "credential compromise suspected",
    }, c);
    expect(good).toMatchObject({ ok: true });
    expect(c.decisions[0]?.kind).toBe("recommend_runbook");
  });

  it("write_briefing rejects sub-50-char output but accepts a real one", async () => {
    const c = ctx();
    expect(await runTool("write_briefing", { markdown: "too short" }, c))
      .toMatchObject({ error: expect.stringContaining("50") });
    const good = await runTool("write_briefing", {
      markdown: "# Today's posture\n\nNo critical exposure observed. Three matches handled.",
    }, c);
    expect(good).toMatchObject({ ok: true });
    expect(c.briefing.markdown).toContain("Today's posture");
  });

  it("finish flips the finished flag so the loop can exit", async () => {
    const c = ctx();
    await runTool("finish", {}, c);
    expect(c.finished.value).toBe(true);
  });
});
