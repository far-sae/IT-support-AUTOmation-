import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { DETECTION_RULES, publicDetectionCatalog } = await import("./registry.js");

describe("Phase 19 — detection rules registry", () => {
  it("has 21 detection rules wired up (Phase 19 added 15; Phase 25 added kev_mentioned_in_ticket)", () => {
    expect(DETECTION_RULES.length).toBe(21);
  });

  it("every rule has unique key + non-empty name/description", () => {
    const keys = new Set<string>();
    for (const r of DETECTION_RULES) {
      expect(r.key).toBeTypeOf("string");
      expect(r.key.length).toBeGreaterThan(0);
      expect(keys.has(r.key)).toBe(false);
      keys.add(r.key);
      expect(r.name).toBeTypeOf("string");
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.description).toBeTypeOf("string");
      expect(r.description.length).toBeGreaterThan(20);
      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(r.severity);
      expect(r.windowMinutes).toBeGreaterThan(0);
      expect(typeof r.detect).toBe("function");
    }
  });

  it("publicDetectionCatalog mirrors every rule (no detect closure)", () => {
    const catalog = publicDetectionCatalog();
    expect(catalog.length).toBe(DETECTION_RULES.length);
    for (const c of catalog) expect("detect" in c).toBe(false);
  });

  it("includes the 15 new Phase 19 rules by key", () => {
    const expectedNewKeys = [
      "mass_password_reset_attempts", "privileged_account_creation", "suspicious_login_volume",
      "outdated_agent_fleet", "stale_device_burst", "disk_full_burst",
      "ticket_storm_unassigned", "sla_breach_spike", "same_submitter_burst",
      "agent_action_failure_rate", "workflow_compensating_burst", "patch_rollout_failure",
      "encryption_extension_burst", "after_hours_admin_action", "data_exfil_keywords",
    ];
    const actualKeys = new Set(DETECTION_RULES.map((r) => r.key));
    for (const k of expectedNewKeys) expect(actualKeys.has(k)).toBe(true);
  });

  it("severity distribution is sensible (at least one of each level)", () => {
    const counts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const r of DETECTION_RULES) counts[r.severity] = (counts[r.severity] ?? 0) + 1;
    expect(counts.LOW).toBeGreaterThan(0);
    expect(counts.MEDIUM).toBeGreaterThan(0);
    expect(counts.HIGH).toBeGreaterThan(0);
    expect(counts.CRITICAL).toBeGreaterThan(0);
  });
});
