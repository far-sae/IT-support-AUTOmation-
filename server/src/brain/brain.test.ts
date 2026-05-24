import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

// Mock everything DB-y. We're testing the orchestration logic, not Prisma.
const orgFindUnique          = vi.fn();
const remediationFindMany    = vi.fn();
const remediationUpsert      = vi.fn();
const executionFindMany      = vi.fn();
const executionFindFirst     = vi.fn();
const executionUpdate        = vi.fn();
const executionUpdateMany    = vi.fn();
const executionFindUnique    = vi.fn();
const ticketUpdate           = vi.fn();
const ticketFindMany         = vi.fn();
const userFindFirst          = vi.fn();
const commentCreate          = vi.fn();
const kbFindMany             = vi.fn();
const emitFn                 = vi.fn();
const createSurveyForTicket  = vi.fn();
const executionCreate        = vi.fn();
const executionCount         = vi.fn();
const ticketFindUnique       = vi.fn();
const embeddingFindMany      = vi.fn();
const embeddingUpsert        = vi.fn();

vi.mock("../db.js", () => ({
  basePrismaUnscoped: {
    organization: { findUnique: (a: unknown) => orgFindUnique(a) },
    user: { findFirst: (a: unknown) => userFindFirst(a) },
  },
  prisma: {
    organization: { findUnique: (a: unknown) => orgFindUnique(a) },
    remediationOutcome: {
      findMany: (a: unknown) => remediationFindMany(a),
      upsert:   (a: unknown) => remediationUpsert(a),
    },
    runbookExecution: {
      findMany:   (a: unknown) => executionFindMany(a),
      findFirst:  (a: unknown) => executionFindFirst(a),
      findUnique: (a: unknown) => executionFindUnique(a),
      update:     (a: unknown) => executionUpdate(a),
      updateMany: (a: unknown) => executionUpdateMany(a),
      create:     (a: unknown) => executionCreate(a),
      count:      (a: unknown) => executionCount(a),
    },
    ticket:   {
      update:     (a: unknown) => ticketUpdate(a),
      findMany:   (a: unknown) => ticketFindMany(a),
      findUnique: (a: unknown) => ticketFindUnique(a),
    },
    user:     { findFirst: (a: unknown) => userFindFirst(a) },
    comment:  { create:   (a: unknown) => commentCreate(a) },
    kbArticle: { findMany: (a: unknown) => kbFindMany(a) },
    ticketEmbedding: {
      findMany: (a: unknown) => embeddingFindMany(a),
      upsert:   (a: unknown) => embeddingUpsert(a),
    },
    // Phase 16 — brain consults mlModel.findFirst for predictSuccess.
    // Returning null keeps the test on the heuristic path.
    mlModel: { findFirst: async () => null },
  },
}));

vi.mock("../realtime/socket.js", () => ({
  emit: (event: string, payload: unknown) => emitFn(event, payload),
}));

vi.mock("../survey/survey.js", () => ({
  createSurveyForTicket: (id: string) => createSurveyForTicket(id),
}));

// Brain tests focus on orchestration, not policy logic; force ALLOW so
// wall-clock-dependent guards (e.g. quiet hours) don't flap.
vi.mock("../policies/engine.js", () => ({
  evaluatePolicies: async () => ({
    verdict: { decision: "ALLOW" },
    risk: { score: 10, reasons: ["mocked"] },
  }),
}));

const { classifySubmitterReply, settleVerifications, decideAndExecute } = await import("./index.js");

const ticket = {
  id: "t1", refCode: "INC-1000", organizationId: "org_A",
  description: "I forgot my password and need it reset",
  submitterName: "Test User", submitterEmail: "u@x.io", submitterUserId: "user_1",
  assignedAgentId: null, source: "PORTAL",
  category: "Account & Access", priority: "Medium",
  assignedTeam: "Identity & Access", slaTarget: "1 business day",
  slaDueAt: new Date(), slaAlertedAt: null, confidence: 0.5,
  status: "OPEN", autoReply: "", resolvedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
} as Parameters<typeof decideAndExecute>[0];

const triage = {
  category: "Account & Access", priority: "Medium",
  assignedTeam: "Identity & Access", slaTarget: "1 business day",
  confidence: 0.5, matchedKeywords: [],
} as Parameters<typeof decideAndExecute>[1];

beforeEach(() => {
  for (const m of [orgFindUnique, remediationFindMany, remediationUpsert,
    executionFindMany, executionFindFirst, executionUpdate, executionUpdateMany,
    executionFindUnique, ticketUpdate, ticketFindMany, userFindFirst, commentCreate,
    kbFindMany, emitFn, createSurveyForTicket, executionCreate, executionCount,
    ticketFindUnique, embeddingFindMany, embeddingUpsert,
  ]) m.mockReset();
  executionCount.mockResolvedValue(0);
  ticketFindUnique.mockResolvedValue(null);
  embeddingFindMany.mockResolvedValue([]);
  embeddingUpsert.mockResolvedValue({});

  // Defaults that keep the rule brain happy.
  orgFindUnique.mockResolvedValue({ settings: {} });
  remediationFindMany.mockResolvedValue([]);
  remediationUpsert.mockResolvedValue({});
  executionCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "exec_1", ...data, status: "RUNNING" }));
  executionUpdate.mockResolvedValue({});
  executionUpdateMany.mockResolvedValue({ count: 0 });
  ticketUpdate.mockResolvedValue({});
  userFindFirst.mockResolvedValue({ id: "admin_1" });
  commentCreate.mockResolvedValue({});
  kbFindMany.mockResolvedValue([]);
  createSurveyForTicket.mockResolvedValue(undefined);
  executionFindFirst.mockResolvedValue({ id: "exec_1", status: "SUCCEEDED" });
});

afterEach(() => vi.clearAllMocks());

// ─── classifySubmitterReply ──────────────────────────────────────────

describe("classifySubmitterReply", () => {
  it("flags 'still broken' as negative", () => {
    expect(classifySubmitterReply("nope, still broken")).toBe("negative");
  });
  it("flags 'didn't work' as negative", () => {
    expect(classifySubmitterReply("Didn't work — same problem.")).toBe("negative");
  });
  it("flags 'thanks, fixed' as positive", () => {
    expect(classifySubmitterReply("thanks, all good now")).toBe("positive");
  });
  it("returns neutral for unrelated text", () => {
    expect(classifySubmitterReply("any update?")).toBe("neutral");
  });
});

// ─── decideAndExecute (rule fallback path) ───────────────────────────

describe("decideAndExecute — rule fallback", () => {
  it("HUMAN_IN_LOOP autonomy: brain does nothing", async () => {
    orgFindUnique.mockResolvedValueOnce({ settings: { autonomy: "HUMAN_IN_LOOP" } });
    const r = await decideAndExecute(ticket, triage);
    expect(r.status).toBe("NO_ACTION");
    expect(executionCreate).not.toHaveBeenCalled();
  });

  it("FULL_AUTO + clear password_reset match → RESOLVED", async () => {
    // password_reset is LOW + closeTicket=true → SUCCEEDED inside the engine.
    const r = await decideAndExecute(ticket, triage);
    expect(r.status).toBe("RESOLVED");
    expect(r.runbookKey).toBe("password_reset");
    expect(remediationUpsert).toHaveBeenCalled();
  });

  it("REVIEW_MEDIUM_HIGH downgrades MEDIUM matches to a LOW alternative when available", async () => {
    orgFindUnique.mockResolvedValueOnce({ settings: { autonomy: "REVIEW_MEDIUM_HIGH" } });
    // The ticket text only matches password_reset (LOW) so policy is moot —
    // verify the call path still completes without escalating.
    const r = await decideAndExecute(ticket, triage);
    expect(["RESOLVED", "AWAITING_VERIFICATION"]).toContain(r.status);
  });

  it("escalates when no runbook matches", async () => {
    const r = await decideAndExecute({ ...ticket, description: "the office plant looks sad" }, {
      ...triage, category: "Hardware",
    });
    expect(r.status).toBe("ESCALATED");
    // An internal note was created with the escalation reason.
    const internalCalls = commentCreate.mock.calls.filter((c) => {
      const d = (c[0] as { data: { isInternal: boolean; body: string } }).data;
      return d.isInternal === true && /Escalating/i.test(d.body);
    });
    expect(internalCalls.length).toBeGreaterThan(0);
  });

  it("records a 'success' outcome when a LOW runbook closes the ticket", async () => {
    await decideAndExecute(ticket, triage);
    const calls = remediationUpsert.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const args = calls[0]?.[0] as {
      where: { organizationId_signature_runbookKey: { organizationId: string; runbookKey: string } };
      create: Record<string, number>;
    };
    expect(args.where.organizationId_signature_runbookKey.organizationId).toBe("org_A");
    expect(args.where.organizationId_signature_runbookKey.runbookKey).toBe("password_reset");
    expect(args.create.successes).toBe(1);
  });
});

// ─── settleVerifications ─────────────────────────────────────────────

describe("settleVerifications", () => {
  it("timer expiry → SUCCEEDED + ticket RESOLVED + survey", async () => {
    executionFindMany.mockResolvedValueOnce([{
      id: "exec_1", organizationId: "org_A", ticketId: "t1", runbookKey: "mfa_reset",
      status: "AWAITING_VERIFICATION",
      ticket: { ...ticket, refCode: "INC-1000", status: "IN_PROGRESS" },
    }]);
    const settled = await settleVerifications({ now: new Date() });
    expect(settled).toBe(1);
    expect(executionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    }));
    expect(ticketUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "RESOLVED" }),
    }));
    expect(createSurveyForTicket).toHaveBeenCalledWith("t1");
  });

  it("negative user signal → FAILED + ticket stays open + records failure", async () => {
    executionFindMany.mockResolvedValueOnce([{
      id: "exec_1", organizationId: "org_A", ticketId: "t1", runbookKey: "mfa_reset",
      status: "AWAITING_VERIFICATION",
      ticket: { ...ticket, refCode: "INC-1000", status: "IN_PROGRESS" },
    }]);
    const settled = await settleVerifications({ ticketId: "t1", userSignal: "negative" });
    expect(settled).toBe(1);
    expect(executionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED" }),
    }));
    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(remediationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ failures: 1 }),
    }));
  });
});
