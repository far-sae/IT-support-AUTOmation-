import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { validateRuleSpec, alertMatches, evaluateRule } = await import("./dsl.js");
import type { RuleMatchableAlert, RuleSpec } from "./dsl.js";

const NOW = new Date("2026-05-22T14:00:00Z");

function alert(over: Partial<RuleMatchableAlert>): RuleMatchableAlert {
  return {
    source: "wazuh", sourceRuleId: "100002",
    level: 7, description: "Generic alert",
    mitreTechniqueId: "T1486", agentName: "laptop-1",
    srcIp: "10.0.0.1", dstIp: "10.0.0.2",
    createdAt: NOW,
    ...over,
  };
}

describe("validateRuleSpec", () => {
  it("accepts a well-formed spec", () => {
    const s = validateRuleSpec({
      match: { mitreTechniqueId: "T1486" },
      window: { minutes: 10 },
      threshold: { count: 3 },
    });
    expect(s.window.minutes).toBe(10);
  });
  it("rejects missing match/window/threshold", () => {
    expect(() => validateRuleSpec({ window: { minutes: 1 }, threshold: { count: 1 } })).toThrow(/match/);
    expect(() => validateRuleSpec({ match: {}, threshold: { count: 1 } })).toThrow(/window/);
    expect(() => validateRuleSpec({ match: {}, window: { minutes: 1 } })).toThrow(/threshold/);
  });
  it("rejects nonsense numbers", () => {
    expect(() => validateRuleSpec({ match: {}, window: { minutes: -1 }, threshold: { count: 1 } }))
      .toThrow(/window\.minutes/);
    expect(() => validateRuleSpec({ match: {}, window: { minutes: 2000 }, threshold: { count: 1 } }))
      .toThrow(/window\.minutes/);
    expect(() => validateRuleSpec({ match: {}, window: { minutes: 10 }, threshold: { count: 0 } }))
      .toThrow(/threshold\.count/);
  });
});

describe("alertMatches", () => {
  const spec: RuleSpec = {
    match: { mitreTechniqueId: "T1486", minLevel: 7, descriptionContains: "encrypt" },
    window: { minutes: 10 },
    threshold: { count: 1 },
  };
  it("returns true for an alert that satisfies every condition", () => {
    expect(alertMatches(spec, alert({ description: "File encryption detected" }))).toBe(true);
  });
  it("returns false on technique mismatch", () => {
    expect(alertMatches(spec, alert({ mitreTechniqueId: "T1059" }))).toBe(false);
  });
  it("returns false on level below threshold", () => {
    expect(alertMatches(spec, alert({ level: 5 }))).toBe(false);
  });
  it("returns false on description without the substring", () => {
    expect(alertMatches(spec, alert({ description: "nothing of note" }))).toBe(false);
  });
});

describe("evaluateRule", () => {
  it("fires when threshold is met within the window, grouped by agent", () => {
    const spec: RuleSpec = {
      match: { mitreTechniqueId: "T1486", minLevel: 7 },
      window: { minutes: 10 },
      threshold: { count: 3, groupBy: "agentName" },
    };
    const alerts: RuleMatchableAlert[] = [
      alert({ agentName: "laptop-1", createdAt: new Date(NOW.getTime() - 1 * 60 * 1000) }),
      alert({ agentName: "laptop-1", createdAt: new Date(NOW.getTime() - 2 * 60 * 1000) }),
      alert({ agentName: "laptop-1", createdAt: new Date(NOW.getTime() - 3 * 60 * 1000) }),
      alert({ agentName: "laptop-2", createdAt: new Date(NOW.getTime() - 4 * 60 * 1000) }),
    ];
    const fires = evaluateRule(spec, alerts, NOW);
    expect(fires).toHaveLength(1);
    expect(fires[0]?.group).toBe("laptop-1");
    expect(fires[0]?.count).toBe(3);
  });

  it("doesn't fire when alerts are outside the window", () => {
    const spec: RuleSpec = {
      match: { mitreTechniqueId: "T1486" },
      window: { minutes: 5 },
      threshold: { count: 2 },
    };
    const alerts: RuleMatchableAlert[] = [
      alert({ createdAt: new Date(NOW.getTime() - 60 * 60 * 1000) }), // 1 h ago
      alert({ createdAt: new Date(NOW.getTime() - 90 * 60 * 1000) }), // 1.5 h ago
    ];
    expect(evaluateRule(spec, alerts, NOW)).toHaveLength(0);
  });

  it("returns one ungrouped fire when groupBy is omitted", () => {
    const spec: RuleSpec = {
      match: { source: "wazuh" }, window: { minutes: 10 }, threshold: { count: 2 },
    };
    const fires = evaluateRule(spec, [
      alert({ agentName: "a", createdAt: NOW }),
      alert({ agentName: "b", createdAt: NOW }),
    ], NOW);
    expect(fires).toHaveLength(1);
    expect(fires[0]?.group).toBe("_");
    expect(fires[0]?.count).toBe(2);
  });
});
