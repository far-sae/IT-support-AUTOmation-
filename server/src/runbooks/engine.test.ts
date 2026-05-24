import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

// ─── Mocks ────────────────────────────────────────────────────────────

const orgFindUnique          = vi.fn();
const kbFindMany             = vi.fn();
const userFindFirst          = vi.fn();
const ticketUpdate           = vi.fn();
const commentCreate          = vi.fn();
const executionCreate        = vi.fn();
const executionUpdate        = vi.fn();
const executionFindUnique    = vi.fn();
const executionCount         = vi.fn();
const emitFn                 = vi.fn();
const createSurveyForTicket  = vi.fn();
const remediationFindMany    = vi.fn();
const ticketFindUnique       = vi.fn();
const embeddingFindMany      = vi.fn();
const embeddingUpsert        = vi.fn();

vi.mock("../db.js", () => ({
  basePrismaUnscoped: {
    organization: { findUnique: (a: unknown) => orgFindUnique(a) },
  },
  prisma: {
    kbArticle: { findMany: (a: unknown) => kbFindMany(a) },
    user: { findFirst: (a: unknown) => userFindFirst(a) },
    ticket: {
      update:     (a: unknown) => ticketUpdate(a),
      findUnique: (a: unknown) => ticketFindUnique(a),
    },
    comment: { create: (a: unknown) => commentCreate(a) },
    runbookExecution: {
      create:     (a: unknown) => executionCreate(a),
      update:     (a: unknown) => executionUpdate(a),
      findUnique: (a: unknown) => executionFindUnique(a),
      count:      (a: unknown) => executionCount(a),
    },
    remediationOutcome: { findMany: (a: unknown) => remediationFindMany(a) },
    ticketEmbedding: {
      findMany: (a: unknown) => embeddingFindMany(a),
      upsert:   (a: unknown) => embeddingUpsert(a),
    },
  },
}));

vi.mock("../realtime/socket.js", () => ({
  emit: (event: string, payload: unknown) => emitFn(event, payload),
}));

vi.mock("../survey/survey.js", () => ({
  createSurveyForTicket: (id: string) => createSurveyForTicket(id),
}));

// Engine tests focus on engine behaviour, not policy logic; force ALLOW so
// wall-clock-dependent guards (e.g. quiet hours) don't flap.
vi.mock("../policies/engine.js", () => ({
  evaluatePolicies: async () => ({
    verdict: { decision: "ALLOW" },
    risk: { score: 10, reasons: ["mocked"] },
  }),
}));

const { pickRunbook, runRunbook, confirmExecution } = await import("./engine.js");

// ─── Helpers ─────────────────────────────────────────────────────────

const makeCtx = (category: string, description: string) => ({
  ticket: {
    id: "t1", refCode: "INC-1000", organizationId: "org_A",
    description, submitterName: "Test User", submitterEmail: "u@x.io",
    submitterUserId: "user_1", assignedAgentId: null,
    source: "PORTAL", category, priority: "Medium",
    assignedTeam: "Identity & Access", slaTarget: "1 business day",
    slaDueAt: new Date(), slaAlertedAt: null, confidence: 0.5,
    status: "OPEN", autoReply: "", resolvedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as Parameters<typeof runRunbook>[0]["ticket"],
  triage: {
    category, priority: "Medium", assignedTeam: "Identity & Access",
    slaTarget: "1 business day", confidence: 0.5, matchedKeywords: [],
  } as Parameters<typeof runRunbook>[0]["triage"],
});

beforeEach(() => {
  orgFindUnique.mockReset();
  kbFindMany.mockReset();
  userFindFirst.mockReset();
  ticketUpdate.mockReset();
  commentCreate.mockReset();
  executionCreate.mockReset();
  executionUpdate.mockReset();
  executionFindUnique.mockReset();
  executionCount.mockReset();
  emitFn.mockReset();
  createSurveyForTicket.mockReset();
  remediationFindMany.mockReset();
  ticketFindUnique.mockReset();
  embeddingFindMany.mockReset();
  embeddingUpsert.mockReset();

  // Sensible defaults.
  orgFindUnique.mockResolvedValue({ settings: {} });
  kbFindMany.mockResolvedValue([]);
  userFindFirst.mockResolvedValue({ id: "admin_1" });
  executionCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "exec_1", ...data }));
  executionUpdate.mockResolvedValue({});
  executionCount.mockResolvedValue(0);
  commentCreate.mockResolvedValue({});
  ticketUpdate.mockResolvedValue({});
  ticketFindUnique.mockResolvedValue(null);
  createSurveyForTicket.mockResolvedValue(undefined);
  remediationFindMany.mockResolvedValue([]);
  embeddingFindMany.mockResolvedValue([]);
  embeddingUpsert.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

// ─── pickRunbook ─────────────────────────────────────────────────────

describe("pickRunbook", () => {
  it("picks password_reset for a clear forgot-password ticket", async () => {
    const pick = await pickRunbook(makeCtx("Account & Access", "I forgot my password, please reset"));
    expect(pick?.runbook.key).toBe("password_reset");
  });

  it("picks account_unlock over password_reset when both 'locked' and 'password' appear", async () => {
    const pick = await pickRunbook(makeCtx("Account & Access", "I'm locked out, password not working"));
    expect(pick?.runbook.key).toBe("account_unlock");
  });

  it("returns null when no runbook matches", async () => {
    const pick = await pickRunbook(makeCtx("Hardware", "my keyboard makes a weird sound"));
    expect(pick).toBeNull();
  });

  it("skips runbooks disabled for the org", async () => {
    orgFindUnique.mockResolvedValueOnce({ settings: { disabledRunbooks: ["password_reset", "account_unlock"] } });
    const pick = await pickRunbook(makeCtx("Account & Access", "forgot my password reset"));
    expect(pick?.runbook.key).not.toBe("password_reset");
    expect(pick?.runbook.key).not.toBe("account_unlock");
  });
});

// ─── runRunbook ──────────────────────────────────────────────────────

describe("runRunbook", () => {
  it("LOW-risk + SUCCEEDED + closeTicket: posts comment, closes ticket, fires survey", async () => {
    const ctx = makeCtx("Account & Access", "i'm locked out");
    const pick = (await pickRunbook(ctx))!;
    await runRunbook(ctx, pick);

    // Public comment posted with the runbook's text
    const publicComments = commentCreate.mock.calls.filter(
      (c) => ((c[0] as { data: { isInternal: boolean } }).data.isInternal === false),
    );
    expect(publicComments.length).toBe(1);

    // Ticket updated to RESOLVED
    expect(ticketUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "t1" },
      data: expect.objectContaining({ status: "RESOLVED" }),
    }));

    // Survey fired
    expect(createSurveyForTicket).toHaveBeenCalledWith("t1");

    // Execution row marked SUCCEEDED
    expect(executionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    }));

    // Socket events fired
    const events = emitFn.mock.calls.map((c) => c[0]);
    expect(events).toContain("ticket:updated");
    expect(events).toContain("analytics:updated");
  });

  it("MEDIUM-risk + AWAITING_USER: posts comment, does NOT close, does NOT fire survey", async () => {
    const ctx = makeCtx("Account & Access", "mfa is broken, please reset");
    const pick = (await pickRunbook(ctx))!;
    expect(pick.runbook.key).toBe("mfa_reset");

    await runRunbook(ctx, pick);
    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(createSurveyForTicket).not.toHaveBeenCalled();
    expect(executionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "AWAITING_USER" }),
    }));
  });
});

// ─── confirmExecution ────────────────────────────────────────────────

describe("confirmExecution", () => {
  it("'fixed' on AWAITING_USER → ticket RESOLVED + survey", async () => {
    executionFindUnique.mockResolvedValueOnce({
      id: "exec_1", organizationId: "org_A", ticketId: "t1", status: "AWAITING_USER",
      ticket: { refCode: "INC-1000", status: "IN_PROGRESS", submitterUserId: "user_1", submitterEmail: "u@x.io" },
    });
    await confirmExecution("exec_1", "fixed", { id: "user_1", role: "EMPLOYEE" });
    expect(ticketUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "RESOLVED" }),
    }));
    expect(createSurveyForTicket).toHaveBeenCalledWith("t1");
  });

  it("'still_broken' on AWAITING_USER → execution CANCELLED, ticket NOT closed", async () => {
    executionFindUnique.mockResolvedValueOnce({
      id: "exec_1", organizationId: "org_A", ticketId: "t1", status: "AWAITING_USER",
      ticket: { refCode: "INC-1000", status: "IN_PROGRESS", submitterUserId: "user_1", submitterEmail: "u@x.io" },
    });
    await confirmExecution("exec_1", "still_broken", { id: "user_1", role: "EMPLOYEE" });
    expect(executionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(createSurveyForTicket).not.toHaveBeenCalled();
  });

  it("rejects confirmation when execution isn't AWAITING_USER", async () => {
    executionFindUnique.mockResolvedValueOnce({
      id: "exec_1", organizationId: "org_A", ticketId: "t1", status: "SUCCEEDED",
      ticket: { refCode: "INC-1000", status: "RESOLVED", submitterUserId: "user_1", submitterEmail: "u@x.io" },
    });
    await expect(confirmExecution("exec_1", "fixed", { id: "user_1", role: "EMPLOYEE" }))
      .rejects.toThrow(/AWAITING_USER/);
  });
});
