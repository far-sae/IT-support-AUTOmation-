import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { alignWindowStart } = await import("./types.js");
const {
  ransomwareLanguage, securityBurst, mfaBruteForce,
  runbookFailureSpike, fleetDegradation,
} = await import("./builtins.js");
import type { DetectionPrisma } from "./types.js";

// Tiny fake Prisma whose return values come from per-test maps. Every
// optional model just returns its empty/zero value when not configured.
function makePrisma(stub: {
  tickets?: Array<Record<string, unknown>>;
  ticketCount?: number;
  runbookGroups?: Array<{ runbookKey: string; _count: { _all: number } }>;
  runbookCount?: number;
  criticalDeviceCount?: number;
  criticalDeviceSample?: Array<{ hostname: string; agentVersion?: string | null; lastCheckInAt?: Date | null }>;
  users?: Array<{ email: string; name: string; createdAt: Date }>;
  agentActionGroups?: Array<{ status: string; _count: { _all: number } }>;
  workflowCount?: number;
  workflows?: Array<{ id: string; workflowKey: string; status: string }>;
}): DetectionPrisma {
  return {
    ticket: {
      findMany: async () => (stub.tickets ?? []) as Array<{
        id: string; refCode: string; description: string; submitterEmail: string;
      }>,
      count: async () => stub.ticketCount ?? 0,
    },
    runbookExecution: {
      groupBy: async () => stub.runbookGroups ?? [],
      count: async () => stub.runbookCount ?? 0,
    },
    device: {
      count: async () => stub.criticalDeviceCount ?? 0,
      findMany: async () => stub.criticalDeviceSample ?? [],
    },
    user: {
      findMany: async () => stub.users ?? [],
    },
    agentAction: {
      groupBy: async () => stub.agentActionGroups ?? [],
    },
    workflowExecution: {
      count: async () => stub.workflowCount ?? 0,
      findMany: async () => stub.workflows ?? [],
    },
  };
}

const NOW = new Date("2026-05-22T14:23:00Z");

describe("alignWindowStart", () => {
  it("aligns to 10-minute buckets", () => {
    expect(alignWindowStart(new Date("2026-05-22T14:23:00Z"), 10).toISOString())
      .toBe("2026-05-22T14:20:00.000Z");
  });
  it("aligns to 30-minute buckets", () => {
    expect(alignWindowStart(new Date("2026-05-22T14:23:00Z"), 30).toISOString())
      .toBe("2026-05-22T14:00:00.000Z");
  });
  it("aligns to 60-minute buckets", () => {
    expect(alignWindowStart(new Date("2026-05-22T14:23:00Z"), 60).toISOString())
      .toBe("2026-05-22T14:00:00.000Z");
  });
});

describe("ransomwareLanguage", () => {
  it("fires CRITICAL on a single matching ticket", async () => {
    const prisma = makePrisma({
      tickets: [{ id: "t1", refCode: "INC-1", description: "all files are encrypted, pay in bitcoin" }],
    });
    const matches = await ransomwareLanguage.detect({ organizationId: "org_A", prisma, now: NOW });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.count).toBe(1);
    expect(ransomwareLanguage.severity).toBe("CRITICAL");
  });

  it("doesn't fire on benign tickets", async () => {
    const prisma = makePrisma({
      tickets: [{ id: "t1", refCode: "INC-2", description: "my mouse stopped working" }],
    });
    const matches = await ransomwareLanguage.detect({ organizationId: "org_A", prisma, now: NOW });
    expect(matches).toHaveLength(0);
  });
});

describe("securityBurst", () => {
  it("requires 5+ tickets to fire", async () => {
    const four = Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`, refCode: `INC-${i}`, submitterEmail: `u${i}@x.io`, description: "phishing email",
    }));
    expect(await securityBurst.detect({
      organizationId: "org_A", prisma: makePrisma({ tickets: four }), now: NOW,
    })).toHaveLength(0);

    const six = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`, refCode: `INC-${i}`, submitterEmail: `u${i}@x.io`, description: "phishing email",
    }));
    const hit = await securityBurst.detect({
      organizationId: "org_A", prisma: makePrisma({ tickets: six }), now: NOW,
    });
    expect(hit).toHaveLength(1);
    expect(hit[0]?.count).toBe(6);
    expect(hit[0]?.evidence.distinctSubmitters).toBe(6);
  });
});

describe("mfaBruteForce", () => {
  it("fires when one submitter has 3+ MFA tickets in the window", async () => {
    const tickets = [
      { submitterEmail: "alice@x.io", refCode: "INC-1" },
      { submitterEmail: "alice@x.io", refCode: "INC-2" },
      { submitterEmail: "alice@x.io", refCode: "INC-3" },
      { submitterEmail: "bob@x.io",   refCode: "INC-4" },
    ];
    const hits = await mfaBruteForce.detect({
      organizationId: "org_A", prisma: makePrisma({ tickets }), now: NOW,
    });
    expect(hits).toHaveLength(1);
    expect((hits[0]!.evidence as Record<string, string[]>)["alice@x.io"]).toHaveLength(3);
  });

  it("does not fire when no submitter has 3+", async () => {
    const tickets = [
      { submitterEmail: "alice@x.io", refCode: "INC-1" },
      { submitterEmail: "alice@x.io", refCode: "INC-2" },
      { submitterEmail: "bob@x.io",   refCode: "INC-3" },
    ];
    expect(await mfaBruteForce.detect({
      organizationId: "org_A", prisma: makePrisma({ tickets }), now: NOW,
    })).toHaveLength(0);
  });
});

describe("runbookFailureSpike", () => {
  it("fires when a runbook key failed 3+ times", async () => {
    const groups = [
      { runbookKey: "restart_service",       _count: { _all: 4 } },
      { runbookKey: "apply_pending_updates", _count: { _all: 2 } },
    ];
    const hits = await runbookFailureSpike.detect({
      organizationId: "org_A", prisma: makePrisma({ runbookGroups: groups }), now: NOW,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.count).toBe(4);
    expect((hits[0]!.evidence as { offenders: Array<{ runbookKey: string }> }).offenders[0]?.runbookKey)
      .toBe("restart_service");
  });
});

describe("fleetDegradation", () => {
  it("fires once 5+ devices are CRITICAL", async () => {
    const hits = await fleetDegradation.detect({
      organizationId: "org_A",
      prisma: makePrisma({
        criticalDeviceCount: 7,
        criticalDeviceSample: [{ hostname: "laptop-1" }, { hostname: "laptop-2" }],
      }),
      now: NOW,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.count).toBe(7);
    expect((hits[0]!.evidence as { sampleHostnames: string[] }).sampleHostnames).toContain("laptop-1");
  });

  it("doesn't fire under threshold", async () => {
    expect(await fleetDegradation.detect({
      organizationId: "org_A", prisma: makePrisma({ criticalDeviceCount: 4 }), now: NOW,
    })).toHaveLength(0);
  });
});
