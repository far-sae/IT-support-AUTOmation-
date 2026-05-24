import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

import { passwordResetRunbook } from "./password_reset.js";
import { mfaResetRunbook } from "./mfa_reset.js";
import { accountUnlockRunbook } from "./account_unlock.js";
import { licenseAssignRunbook } from "./license_assign.js";
import { softwareInstallRunbook } from "./software_install.js";
import type { RunbookContext } from "./types.js";

function ctx(category: string, description: string): RunbookContext {
  return {
    ticket: {
      id: "t1", refCode: "INC-1000", organizationId: "org_A",
      description, submitterName: "Test User", submitterEmail: "u@x.io",
      // unused-but-required fields:
      source: "PORTAL", submitterUserId: null, assignedAgentId: null,
      category, priority: "Medium", assignedTeam: "—", slaTarget: "1 business day",
      slaDueAt: new Date(), slaAlertedAt: null, confidence: 0.5,
      status: "OPEN", autoReply: "", resolvedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as RunbookContext["ticket"],
    triage: {
      category, priority: "Medium", assignedTeam: "—", slaTarget: "1 business day",
      confidence: 0.5, matchedKeywords: [],
    } as RunbookContext["triage"],
  };
}

// ─── password_reset ──────────────────────────────────────────────────

describe("password_reset matcher", () => {
  it("matches an Account & Access ticket asking for a reset", () => {
    const m = passwordResetRunbook.match(ctx("Account & Access", "I forgot my password and need to reset it"));
    expect(m.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("doesn't match if the ticket is about MFA", () => {
    const m = passwordResetRunbook.match(ctx("Account & Access", "my mfa authenticator broke and i'm stuck"));
    expect(m.confidence).toBe(0);
  });

  it("doesn't match a locked-out ticket (that's account_unlock's job)", () => {
    const m = passwordResetRunbook.match(ctx("Account & Access", "I'm locked out of my account"));
    expect(m.confidence).toBe(0);
  });

  it("doesn't match a Network ticket", () => {
    const m = passwordResetRunbook.match(ctx("Network", "i forgot my password"));
    expect(m.confidence).toBe(0);
  });

  it("returns a SUCCEEDED outcome with close=true on execute", async () => {
    const out = await passwordResetRunbook.execute(ctx("Account & Access", "i forgot my password"));
    expect(out.status).toBe("SUCCEEDED");
    expect(out.closeTicket).toBe(true);
    expect(out.publicComment).toContain("password reset");
  });
});

// ─── mfa_reset ───────────────────────────────────────────────────────

describe("mfa_reset matcher", () => {
  it("matches Account & Access + mfa keyword", () => {
    const m = mfaResetRunbook.match(ctx("Account & Access", "MFA isn't working at all today"));
    expect(m.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("matches harder when there's also 'reset'/'broken'", () => {
    const a = mfaResetRunbook.match(ctx("Account & Access", "MFA isn't working"));
    const b = mfaResetRunbook.match(ctx("Account & Access", "MFA broken, please reset"));
    expect(b.confidence).toBeGreaterThanOrEqual(a.confidence);
  });

  it("returns AWAITING_USER on execute", async () => {
    const out = await mfaResetRunbook.execute(ctx("Account & Access", "mfa broken"));
    expect(out.status).toBe("AWAITING_USER");
  });
});

// ─── account_unlock ──────────────────────────────────────────────────

describe("account_unlock matcher", () => {
  it("matches 'locked out'", () => {
    const m = accountUnlockRunbook.match(ctx("Account & Access", "I'm locked out of my account, mfa reset failed"));
    expect(m.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("doesn't match if not Account & Access", () => {
    expect(accountUnlockRunbook.match(ctx("Network", "locked")).confidence).toBe(0);
  });

  it("execute closes the ticket", async () => {
    const out = await accountUnlockRunbook.execute(ctx("Account & Access", "locked out"));
    expect(out.status).toBe("SUCCEEDED");
    expect(out.closeTicket).toBe(true);
  });
});

// ─── license_assign ──────────────────────────────────────────────────

describe("license_assign matcher", () => {
  it("matches Software + license keyword", () => {
    const m = licenseAssignRunbook.match(ctx("Software", "I need an Excel license assigned"));
    expect(m.confidence).toBeGreaterThan(0.5);
  });

  it("doesn't match in the wrong category", () => {
    expect(licenseAssignRunbook.match(ctx("Hardware", "need a license")).confidence).toBe(0);
  });
});

// ─── software_install ───────────────────────────────────────────────

describe("software_install matcher", () => {
  it("matches 'install Slack'", () => {
    const m = softwareInstallRunbook.match(ctx("Software", "please install Slack on my new laptop"));
    expect(m.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("doesn't match a complaint about Slack crashing", () => {
    const m = softwareInstallRunbook.match(ctx("Software", "Slack keeps crashing every time I open it"));
    expect(m.confidence).toBe(0);
  });

  it("doesn't match without a known app", () => {
    const m = softwareInstallRunbook.match(ctx("Software", "install something cool"));
    expect(m.confidence).toBe(0);
  });
});
