import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { computeRisk, riskBucket } = await import("./risk.js");
const {
  noCriticalDuringBusinessHours, requireApprovalForHighRisk,
  noMassAction, quietHours, noUpdatesOnOpenTickets,
} = await import("./builtins.js");

import type { PolicyContext } from "./types.js";

function ctx(overrides: Partial<PolicyContext>): PolicyContext {
  return {
    ticket: {
      id: "t1", organizationId: "org_A", refCode: "INC-1",
      description: "x", priority: "Medium", category: "Software",
      submitterName: "U", submitterEmail: "u@x.io",
      source: "PORTAL", submitterUserId: null, assignedAgentId: null,
      assignedTeam: "—", slaTarget: "1 business day", slaDueAt: new Date(),
      slaAlertedAt: null, confidence: 0.5, status: "OPEN", autoReply: "",
      resolvedAt: null, createdAt: new Date(), updatedAt: new Date(),
    } as PolicyContext["ticket"],
    runbook: {
      key: "restart_service", name: "x", description: "y", risk: "MEDIUM",
      match: () => ({ confidence: 0.8, reason: "" }),
      execute: async () => ({ status: "SUCCEEDED", publicComment: "", decision: {} }),
    } as PolicyContext["runbook"],
    risk: { score: 30, reasons: [] },
    settings: {},
    recentRunbookCount: 0,
    now: new Date(Date.UTC(2026, 4, 22, 14, 0)), // Fri 14:00 UTC — in business hours
    ...overrides,
  };
}

// ─── Risk math ───────────────────────────────────────────────────────

describe("computeRisk", () => {
  it("scores password_reset on a Low-priority Account & Access ticket", () => {
    const r = computeRisk({
      runbookKey: "password_reset", category: "Account & Access", priority: "Low",
    });
    expect(r.score).toBe(25); // 20 + 10 - 5
  });

  it("Critical-priority Security restart_service climbs into elevated", () => {
    const r = computeRisk({
      runbookKey: "restart_service", category: "Security", priority: "Critical",
    });
    expect(r.score).toBeGreaterThanOrEqual(60); // 30 + 15 + 20
    expect(riskBucket(r.score)).toBe("elevated");
  });

  it("history of failures bumps the score", () => {
    const r = computeRisk({
      runbookKey: "restart_service", category: "Software", priority: "Medium",
      failuresAtSignature: 2,
    });
    expect(r.score).toBeGreaterThan(30);
    expect(r.reasons.some((s) => /past failures/.test(s))).toBe(true);
  });

  it("history of successes shaves a little off", () => {
    const r = computeRisk({
      runbookKey: "restart_service", category: "Software", priority: "Medium",
      successesAtSignature: 5,
    });
    expect(r.score).toBeLessThan(30);
  });

  it("github_dispatch is HIGH-risk territory by default", () => {
    const r = computeRisk({
      runbookKey: "github_dispatch", category: "Software", priority: "Medium",
    });
    expect(r.score).toBeGreaterThanOrEqual(60);
  });
});

// ─── Policies ────────────────────────────────────────────────────────

describe("no_critical_business_hours", () => {
  it("blocks risky actions on Critical priority during business hours", () => {
    const v = noCriticalDuringBusinessHours.evaluate(ctx({
      ticket: { ...ctx({}).ticket, priority: "Critical" },
      risk: { score: 55, reasons: [] },
    }));
    expect(v.decision).toBe("DENY");
    if (v.decision === "DENY") expect(v.escalate).toBe(true);
  });

  it("allows the same action outside business hours", () => {
    const v = noCriticalDuringBusinessHours.evaluate(ctx({
      ticket: { ...ctx({}).ticket, priority: "Critical" },
      risk: { score: 55, reasons: [] },
      now: new Date(Date.UTC(2026, 4, 23, 3, 0)), // 03:00 UTC
    }));
    expect(v.decision).toBe("ALLOW");
  });

  it("allows low-risk on Critical priority any time", () => {
    const v = noCriticalDuringBusinessHours.evaluate(ctx({
      ticket: { ...ctx({}).ticket, priority: "Critical" },
      risk: { score: 10, reasons: [] },
    }));
    expect(v.decision).toBe("ALLOW");
  });
});

describe("require_approval_for_high_risk", () => {
  it("blocks anything ≥70", () => {
    const v = requireApprovalForHighRisk.evaluate(ctx({ risk: { score: 72, reasons: [] } }));
    expect(v.decision).toBe("DENY");
    if (v.decision === "DENY") expect(v.escalate).toBe(true);
  });
  it("allows ≤69", () => {
    expect(requireApprovalForHighRisk.evaluate(ctx({ risk: { score: 69, reasons: [] } })).decision).toBe("ALLOW");
  });
});

describe("no_mass_action", () => {
  it("blocks when this runbook fired >5× in the last hour", () => {
    const v = noMassAction.evaluate(ctx({ recentRunbookCount: 6 }));
    expect(v.decision).toBe("DENY");
  });
  it("allows when ≤5", () => {
    expect(noMassAction.evaluate(ctx({ recentRunbookCount: 5 })).decision).toBe("ALLOW");
  });
});

describe("quiet_hours", () => {
  it("blocks risky actions overnight", () => {
    const v = quietHours.evaluate(ctx({
      risk: { score: 30, reasons: [] },
      now: new Date(Date.UTC(2026, 4, 23, 23, 30)),
    }));
    expect(v.decision).toBe("DENY");
  });
  it("allows low-risk actions overnight", () => {
    const v = quietHours.evaluate(ctx({
      risk: { score: 10, reasons: [] },
      now: new Date(Date.UTC(2026, 4, 23, 23, 30)),
    }));
    expect(v.decision).toBe("ALLOW");
  });
  it("allows during the day", () => {
    expect(quietHours.evaluate(ctx({})).decision).toBe("ALLOW");
  });
});

describe("no_updates_on_open_tickets", () => {
  it("blocks apply_pending_updates on Critical tickets", () => {
    const v = noUpdatesOnOpenTickets.evaluate(ctx({
      ticket: { ...ctx({}).ticket, priority: "Critical" },
      runbook: { ...ctx({}).runbook, key: "apply_pending_updates" } as PolicyContext["runbook"],
    }));
    expect(v.decision).toBe("DENY");
  });
  it("ignores other runbooks", () => {
    const v = noUpdatesOnOpenTickets.evaluate(ctx({
      ticket: { ...ctx({}).ticket, priority: "Critical" },
    }));
    expect(v.decision).toBe("ALLOW");
  });
});
