import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

// Dynamic imports so the env-vars above are set before env.ts loads.
const { runDiagnosticRunbook }  = await import("./run_diagnostic.js");
const { restartServiceRunbook } = await import("./restart_service.js");
const { clearCacheRunbook }     = await import("./clear_cache.js");
const { diskCleanupRunbook }    = await import("./disk_cleanup.js");
const { applyUpdatesRunbook }   = await import("./apply_updates.js");
const { /* RunbookContext */ } = await import("./types.js");

import type { RunbookContext } from "./types.js";
import type { TriageResult } from "../triage.js";

function ctx(category: string, description: string): RunbookContext {
  return {
    ticket: {
      id: "t1", refCode: "INC-1000", organizationId: "org_A",
      description, submitterName: "Test User", submitterEmail: "u@x.io",
      source: "PORTAL", submitterUserId: null, assignedAgentId: null,
      category, priority: "Medium", assignedTeam: "—", slaTarget: "1 business day",
      slaDueAt: new Date(), slaAlertedAt: null, confidence: 0.5,
      status: "OPEN", autoReply: "", resolvedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as RunbookContext["ticket"],
    triage: {
      category: category as TriageResult["category"],
      priority: "Medium",
      assignedTeam: "—", slaTarget: "1 business day",
      confidence: 0.5, matchedKeywords: [],
    } as TriageResult,
  };
}

describe("restart_service matcher", () => {
  it("matches 'Outlook keeps crashing'", () => {
    const m = restartServiceRunbook.match(ctx("Software", "Outlook keeps crashing every time I open it"));
    expect(m.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("matches 'Teams is frozen'", () => {
    const m = restartServiceRunbook.match(ctx("Software", "Teams is frozen, won't open"));
    expect(m.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("doesn't match without a fault verb", () => {
    expect(restartServiceRunbook.match(ctx("Software", "How do I use Outlook?")).confidence).toBe(0);
  });
  it("doesn't match an unknown service", () => {
    expect(restartServiceRunbook.match(ctx("Software", "FooBarApp keeps crashing")).confidence).toBe(0);
  });
});

describe("clear_cache matcher", () => {
  it("matches 'Slack stuck loading'", () => {
    const m = clearCacheRunbook.match(ctx("Software", "Slack is stuck loading my channels"));
    expect(m.confidence).toBeGreaterThanOrEqual(0.7);
  });
  it("doesn't match without a known app", () => {
    expect(clearCacheRunbook.match(ctx("Software", "the cache is stale")).confidence).toBe(0);
  });
});

describe("disk_cleanup matcher", () => {
  it("matches an explicit 'disk full'", () => {
    expect(diskCleanupRunbook.match(ctx("Hardware", "my disk is full")).confidence).toBeGreaterThanOrEqual(0.85);
  });
  it("softly matches Hardware + slow", () => {
    expect(diskCleanupRunbook.match(ctx("Hardware", "my laptop is so slow today")).confidence).toBeGreaterThanOrEqual(0.5);
  });
  it("doesn't match Hardware without a slow / disk keyword", () => {
    expect(diskCleanupRunbook.match(ctx("Hardware", "my keyboard makes a weird sound")).confidence).toBe(0);
  });
});

describe("apply_pending_updates matcher", () => {
  it("matches an 'updates pending' ticket", () => {
    expect(applyUpdatesRunbook.match(ctx("Software", "there are updates pending, can you push them?")).confidence).toBeGreaterThanOrEqual(0.7);
  });
  it("doesn't match unrelated text", () => {
    expect(applyUpdatesRunbook.match(ctx("Software", "please install Slack")).confidence).toBe(0);
  });
});

describe("run_diagnostic matcher", () => {
  it("matches a flaky Network ticket", () => {
    expect(runDiagnosticRunbook.match(ctx("Network", "VPN keeps dropping, wifi seems slow today")).confidence).toBeGreaterThanOrEqual(0.6);
  });
  it("doesn't match an Account & Access ticket", () => {
    expect(runDiagnosticRunbook.match(ctx("Account & Access", "I forgot my password")).confidence).toBe(0);
  });
});
