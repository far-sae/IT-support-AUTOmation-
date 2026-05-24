import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { extractFeatures, FEATURE_NAMES } = await import("./features.js");
import type { Ticket } from "@prisma/client";

const TICKET_LOW_HW = {
  priority: "Low", category: "Hardware", createdAt: new Date("2026-05-22T14:00:00Z"),
} as Pick<Ticket, "priority" | "category" | "createdAt">;

const TICKET_CRIT_SEC = {
  priority: "Critical", category: "Security", createdAt: new Date("2026-05-22T14:00:00Z"),
} as Pick<Ticket, "priority" | "category" | "createdAt">;

describe("extractFeatures", () => {
  it("emits a vector of the documented length", () => {
    const v = extractFeatures({
      ticket: TICKET_LOW_HW,
      runbook: { risk: "LOW" }, matchConfidence: 0.6,
      history: { successes: 0, failures: 0 },
      now: new Date("2026-05-22T14:00:00Z"),
    });
    expect(v).toHaveLength(FEATURE_NAMES.length);
  });

  it("one-hots priority correctly", () => {
    const v = extractFeatures({
      ticket: TICKET_CRIT_SEC,
      runbook: { risk: "MEDIUM" }, matchConfidence: 0.5,
      history: { successes: 0, failures: 0 },
      now: new Date("2026-05-22T14:00:00Z"),
    });
    const i = FEATURE_NAMES.indexOf("priority_critical");
    expect(v[i]).toBe(1);
    expect(v[FEATURE_NAMES.indexOf("priority_low")]).toBe(0);
  });

  it("runbook risk maps to 0/0.5/1", () => {
    const idx = FEATURE_NAMES.indexOf("runbook_risk_norm");
    expect(extractFeatures({
      ticket: TICKET_LOW_HW, runbook: { risk: "LOW" }, matchConfidence: 0,
      history: { successes: 0, failures: 0 }, now: new Date(),
    })[idx]).toBe(0);
    expect(extractFeatures({
      ticket: TICKET_LOW_HW, runbook: { risk: "MEDIUM" }, matchConfidence: 0,
      history: { successes: 0, failures: 0 }, now: new Date(),
    })[idx]).toBe(0.5);
    expect(extractFeatures({
      ticket: TICKET_LOW_HW, runbook: { risk: "HIGH" }, matchConfidence: 0,
      history: { successes: 0, failures: 0 }, now: new Date(),
    })[idx]).toBe(1);
  });

  it("smoothed history rate: zero attempts → 0.5 (Beta(1,1) prior)", () => {
    const v = extractFeatures({
      ticket: TICKET_LOW_HW, runbook: { risk: "LOW" }, matchConfidence: 0,
      history: { successes: 0, failures: 0 }, now: new Date(),
    });
    expect(v[FEATURE_NAMES.indexOf("history_success_rate")]).toBe(0.5);
  });

  it("is_business_hours: Friday 14:00 UTC is true, Saturday is false", () => {
    const idx = FEATURE_NAMES.indexOf("is_business_hours");
    // Fri May 22 2026 14:00 UTC
    expect(extractFeatures({
      ticket: TICKET_LOW_HW, runbook: { risk: "LOW" }, matchConfidence: 0,
      history: { successes: 0, failures: 0 },
      now: new Date(Date.UTC(2026, 4, 22, 14, 0)),
    })[idx]).toBe(1);
    // Sat May 23 2026 14:00 UTC
    expect(extractFeatures({
      ticket: TICKET_LOW_HW, runbook: { risk: "LOW" }, matchConfidence: 0,
      history: { successes: 0, failures: 0 },
      now: new Date(Date.UTC(2026, 4, 23, 14, 0)),
    })[idx]).toBe(0);
  });

  it("clamps match confidence to [0,1]", () => {
    const idx = FEATURE_NAMES.indexOf("match_confidence");
    expect(extractFeatures({
      ticket: TICKET_LOW_HW, runbook: { risk: "LOW" }, matchConfidence: 1.7,
      history: { successes: 0, failures: 0 }, now: new Date(),
    })[idx]).toBe(1);
    expect(extractFeatures({
      ticket: TICKET_LOW_HW, runbook: { risk: "LOW" }, matchConfidence: -0.5,
      history: { successes: 0, failures: 0 }, now: new Date(),
    })[idx]).toBe(0);
  });

  it("falls back to category_other for an unrecognised category", () => {
    const v = extractFeatures({
      ticket: { priority: "Medium", category: "Astronomy", createdAt: new Date() } as Pick<Ticket, "priority" | "category" | "createdAt">,
      runbook: { risk: "LOW" }, matchConfidence: 0.5,
      history: { successes: 0, failures: 0 }, now: new Date(),
    });
    expect(v[FEATURE_NAMES.indexOf("category_other")]).toBe(1);
    expect(v[FEATURE_NAMES.indexOf("category_software")]).toBe(0);
  });
});
