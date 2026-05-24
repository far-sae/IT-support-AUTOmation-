import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

// ─── Mocks ──────────────────────────────────────────────────────────

const ticketFindUnique           = vi.fn();
const executionCreate            = vi.fn();
const executionUpdate            = vi.fn();
const executionFindUnique        = vi.fn();
const executionFindMany          = vi.fn();
const stepCreateMany             = vi.fn();
const stepUpdate                 = vi.fn();
const stepUpdateMany             = vi.fn();
const commentCreate              = vi.fn();
const deviceMetricFindFirst      = vi.fn();

vi.mock("../db.js", () => ({
  basePrismaUnscoped: {},
  prisma: {
    ticket:                { findUnique: (a: unknown) => ticketFindUnique(a) },
    workflowExecution:     {
      create:     (a: unknown) => executionCreate(a),
      update:     (a: unknown) => executionUpdate(a),
      findUnique: (a: unknown) => executionFindUnique(a),
      findMany:   (a: unknown) => executionFindMany(a),
    },
    workflowStepExecution: {
      createMany: (a: unknown) => stepCreateMany(a),
      update:     (a: unknown) => stepUpdate(a),
      updateMany: (a: unknown) => stepUpdateMany(a),
    },
    comment:               { create: (a: unknown) => commentCreate(a) },
    deviceMetric:          { findFirst: (a: unknown) => deviceMetricFindFirst(a) },
  },
}));
vi.mock("../tenant/context.js", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));
vi.mock("../email/mailer.js", () => ({
  sendMail: vi.fn().mockResolvedValue({ delivered: true }),
}));

const { startWorkflow, advanceWorkflows, approveWaitingStep } = await import("./engine.js");
const { findWorkflow }                                        = await import("./registry.js");

const TICKET = {
  id: "t1", organizationId: "org_A", refCode: "INC-1",
  description: "vpn keeps disconnecting", category: "Network", priority: "Medium",
  submitterName: "u", submitterEmail: "u@x.io", submitterUserId: "user_1",
  status: "OPEN", autoReply: "", source: "PORTAL", assignedAgentId: null,
  assignedTeam: "—", slaTarget: "1 day", slaDueAt: new Date(), slaAlertedAt: null,
  confidence: 0.5, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  for (const m of [ticketFindUnique, executionCreate, executionUpdate, executionFindUnique,
    executionFindMany, stepCreateMany, stepUpdate, stepUpdateMany,
    commentCreate, deviceMetricFindFirst]) m.mockReset();
  ticketFindUnique.mockResolvedValue(TICKET);
  stepCreateMany.mockResolvedValue({ count: 0 });
  stepUpdate.mockResolvedValue({});
  stepUpdateMany.mockResolvedValue({ count: 0 });
  executionUpdate.mockResolvedValue({});
  commentCreate.mockResolvedValue({});
  deviceMetricFindFirst.mockResolvedValue(null);
});

describe("findWorkflow / registry", () => {
  it("knows triage_network_issue and onboard_employee", () => {
    expect(findWorkflow("triage_network_issue")).toBeDefined();
    expect(findWorkflow("onboard_employee")).toBeDefined();
    expect(findWorkflow("nope")).toBeUndefined();
  });

  it("pickWorkflowForTicket matches a vpn description", async () => {
    const { pickWorkflowForTicket } = await import("./registry.js");
    expect(pickWorkflowForTicket(TICKET as Parameters<typeof pickWorkflowForTicket>[0])?.workflow.key)
      .toBe("triage_network_issue");
  });

  it("pickWorkflowForTicket returns null when nothing matches", async () => {
    const { pickWorkflowForTicket } = await import("./registry.js");
    expect(pickWorkflowForTicket({
      ...TICKET, category: "Hardware", description: "my mouse is broken",
    } as Parameters<typeof pickWorkflowForTicket>[0])).toBeNull();
  });
});

describe("startWorkflow", () => {
  it("creates the execution + pre-creates one row per step + advances the first", async () => {
    executionCreate.mockResolvedValueOnce({
      id: "we_1", organizationId: "org_A", ticketId: TICKET.id,
      workflowKey: "triage_network_issue", status: "RUNNING",
      currentStepKey: "run_diagnostic", context: {}, errorReason: null,
      startedAt: new Date(), completedAt: null,
    });
    // For the initial advance call inside startWorkflow.
    executionFindUnique.mockResolvedValueOnce({
      id: "we_1", organizationId: "org_A", ticketId: TICKET.id,
      workflowKey: "triage_network_issue", status: "RUNNING",
      currentStepKey: "run_diagnostic", context: {}, errorReason: null,
      ticket: TICKET,
      steps: [
        { id: "s1", stepKey: "run_diagnostic",       sequence: 0, status: "PENDING", resumeAt: null, startedAt: null },
        { id: "s2", stepKey: "branch_on_diagnostic", sequence: 1, status: "PENDING", resumeAt: null, startedAt: null },
        { id: "s3", stepKey: "restart_network",      sequence: 2, status: "PENDING", resumeAt: null, startedAt: null },
        { id: "s4", stepKey: "clear_dns_cache",      sequence: 3, status: "PENDING", resumeAt: null, startedAt: null },
        { id: "s5", stepKey: "notify",               sequence: 4, status: "PENDING", resumeAt: null, startedAt: null },
      ],
    });

    const id = await startWorkflow({
      organizationId: "org_A", ticketId: TICKET.id, workflowKey: "triage_network_issue",
    });
    expect(id).toBe("we_1");
    expect(stepCreateMany).toHaveBeenCalledTimes(1);
    const createManyArgs = stepCreateMany.mock.calls[0]?.[0] as { data: Array<{ stepKey: string }> };
    expect(createManyArgs.data.map((s) => s.stepKey)).toEqual([
      "run_diagnostic", "branch_on_diagnostic", "restart_network", "clear_dns_cache", "notify",
    ]);
    // First step was marked RUNNING.
    expect(stepUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "RUNNING" }),
    }));
  });

  it("rejects an unknown workflow", async () => {
    await expect(startWorkflow({
      organizationId: "org_A", ticketId: TICKET.id, workflowKey: "ghost",
    })).rejects.toThrow(/unknown workflow/);
  });
});

describe("advanceWorkflows — branch_on_diagnostic", () => {
  it("after diagnostic runs, branch step decides which path to take", async () => {
    executionFindMany.mockResolvedValueOnce([{ id: "we_1", organizationId: "org_A" }]);
    executionFindUnique.mockResolvedValueOnce({
      id: "we_1", organizationId: "org_A", ticketId: TICKET.id,
      workflowKey: "triage_network_issue", status: "RUNNING",
      currentStepKey: "branch_on_diagnostic",
      context: { run_diagnostic: { packetLossPercent: 12 } },
      ticket: TICKET,
      steps: [
        { id: "s1", stepKey: "run_diagnostic",       sequence: 0, status: "SUCCEEDED", resumeAt: null, startedAt: null },
        { id: "s2", stepKey: "branch_on_diagnostic", sequence: 1, status: "PENDING",   resumeAt: null, startedAt: null },
        { id: "s3", stepKey: "restart_network",      sequence: 2, status: "PENDING",   resumeAt: null, startedAt: null },
        { id: "s4", stepKey: "clear_dns_cache",      sequence: 3, status: "PENDING",   resumeAt: null, startedAt: null },
        { id: "s5", stepKey: "notify",               sequence: 4, status: "PENDING",   resumeAt: null, startedAt: null },
      ],
    });

    const n = await advanceWorkflows();
    expect(n).toBe(1);
    // Diagnostic above-threshold (12 % loss) → branch chooses restart_network.
    // executionUpdate is called with currentStepKey advanced.
    const advanceCalls = executionUpdate.mock.calls
      .map((c) => c[0] as { data?: { currentStepKey?: string } })
      .filter((a) => a.data?.currentStepKey !== undefined);
    const lastTarget = advanceCalls[advanceCalls.length - 1]?.data?.currentStepKey;
    expect(lastTarget).toBe("restart_network");
  });
});

describe("approveWaitingStep", () => {
  it("flips a WAITING step SUCCEEDED + re-advances", async () => {
    // First call: approve does its updates.
    executionFindUnique.mockResolvedValueOnce({
      id: "we_1", organizationId: "org_A", ticketId: TICKET.id,
      workflowKey: "onboard_employee", status: "RUNNING",
      currentStepKey: null, context: {}, ticket: TICKET,
      steps: [
        { id: "s1", stepKey: "assign_device",       sequence: 0, status: "SUCCEEDED", resumeAt: null, startedAt: null },
        { id: "s2", stepKey: "wait_for_enrollment", sequence: 1, status: "SUCCEEDED", resumeAt: null, startedAt: null },
        { id: "s3", stepKey: "send_welcome_email",  sequence: 2, status: "SUCCEEDED", resumeAt: null, startedAt: null },
        { id: "s4", stepKey: "await_hr_approval",   sequence: 3, status: "SUCCEEDED", resumeAt: null, startedAt: null },
      ],
    });

    await approveWaitingStep("we_1", "await_hr_approval", "admin_1");
    expect(stepUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stepKey: "await_hr_approval", status: "WAITING" }),
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    }));
  });
});
