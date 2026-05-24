import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

import { signatureOf, weightConfidence, type RunbookStats } from "./store.js";
import type { TriageResult } from "../triage.js";

const triage = (cat: string): TriageResult => ({
  category: cat as TriageResult["category"],
  priority: "Medium" as TriageResult["priority"],
  assignedTeam: "—",
  slaTarget: "1 business day",
  confidence: 0.5,
  matchedKeywords: [] as string[],
});

describe("signatureOf", () => {
  it("returns a deterministic fingerprint for the same input", () => {
    const a = signatureOf(triage("Account & Access"), "I forgot my password please reset it");
    const b = signatureOf(triage("Account & Access"), "i FORGOT my PASSWORD! please reset it.");
    expect(a).toBe(b);
  });

  it("differs across categories even with the same text", () => {
    const text = "system not working please help";
    expect(signatureOf(triage("Network"), text)).not.toBe(signatureOf(triage("Hardware"), text));
  });

  it("strips stopwords and short tokens", () => {
    const s = signatureOf(triage("Software"), "I have an issue with Slack");
    expect(s).toContain("Software|");
    expect(s).not.toMatch(/\bi\b/);
    expect(s).not.toContain("have");
  });

  it("caps at 8 tokens", () => {
    const big = "vpn wifi router firewall ethernet dns dhcp lan wan internet";
    const s = signatureOf(triage("Network"), big);
    const tokens = s.split("|")[1]!.split("-");
    expect(tokens.length).toBeLessThanOrEqual(8);
  });
});

describe("weightConfidence", () => {
  const raw = 0.7;

  it("returns raw when there is no history", () => {
    const r = weightConfidence(raw, undefined);
    expect(r.weighted).toBe(raw);
    expect(r.reason).toBe("no history");
  });

  it("returns raw when attempts < 3 (not enough data)", () => {
    const stats: RunbookStats = { runbookKey: "x", successes: 1, failures: 1, escalations: 0, successRate: 0.5, attempts: 2 };
    const r = weightConfidence(raw, stats);
    expect(r.weighted).toBe(raw);
  });

  it("blends 60% raw + 40% history once we have enough samples", () => {
    // Force the deterministic path by stubbing Math.random().
    const orig = Math.random;
    Math.random = () => 0.5; // > 0.1 → not exploration
    try {
      const stats: RunbookStats = { runbookKey: "x", successes: 9, failures: 1, escalations: 0, successRate: 0.9, attempts: 10 };
      const r = weightConfidence(raw, stats);
      expect(r.weighted).toBeCloseTo(0.7 * 0.6 + 0.9 * 0.4, 5);
      expect(r.reason).toMatch(/learned/);
    } finally { Math.random = orig; }
  });

  it("falls into the epsilon path 10% of the time and returns raw", () => {
    const orig = Math.random;
    Math.random = () => 0.05; // < 0.1 → epsilon
    try {
      const stats: RunbookStats = { runbookKey: "x", successes: 9, failures: 1, escalations: 0, successRate: 0.9, attempts: 10 };
      const r = weightConfidence(raw, stats);
      expect(r.weighted).toBe(raw);
      expect(r.reason).toMatch(/exploration/);
    } finally { Math.random = orig; }
  });

  it("penalises a poorly-performing runbook", () => {
    const orig = Math.random;
    Math.random = () => 0.5;
    try {
      const stats: RunbookStats = { runbookKey: "x", successes: 1, failures: 9, escalations: 0, successRate: 0.1, attempts: 10 };
      const r = weightConfidence(raw, stats);
      expect(r.weighted).toBeLessThan(raw); // history drags the raw value down
    } finally { Math.random = orig; }
  });
});
