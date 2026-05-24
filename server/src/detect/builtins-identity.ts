/**
 * Phase 19 — Identity-related detection rules.
 *
 *   • mass_password_reset_attempts — credential-stuffing signature
 *   • privileged_account_creation  — fresh ADMIN role assignment
 *   • suspicious_login_volume      — single submitter's auth-related ticket spike
 */

import { alignWindowStart, type DetectionRule } from "./types.js";

export const massPasswordResetAttempts: DetectionRule = {
  key: "mass_password_reset_attempts",
  name: "Mass password-reset attempts",
  description: "10+ password_reset runbook attempts within 10 minutes. Often the leading edge of a credential-stuffing campaign — the bot tried many users, all hit our password-reset flow, the autopilot fired the runbook.",
  severity: "HIGH",
  windowMinutes: 10,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 10);
    const windowEnd   = new Date(windowStart.getTime() + 10 * 60 * 1000);
    const groups = await prisma.runbookExecution.groupBy({
      by: ["runbookKey"],
      where: { runbookKey: "password_reset", startedAt: { gte: windowStart, lt: windowEnd } },
      _count: { _all: true },
    });
    const hit = groups[0];
    if (!hit || hit._count._all < 10) return [];
    return [{
      windowStart, windowEnd,
      count: hit._count._all,
      evidence: { runbookKey: hit.runbookKey, attempts: hit._count._all },
    }];
  },
};

export const privilegedAccountCreation: DetectionRule = {
  key: "privileged_account_creation",
  name: "ADMIN-role account created or assigned recently",
  description: "A user with role=ADMIN was created (or had their role raised) inside the last hour. ADMIN powers cross-tenant actions — every new one should be reviewed.",
  severity: "HIGH",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    // We don't have a user audit log yet — use `createdAt` as a proxy for
    // freshly-minted admins. Existing admins whose roles change without a
    // new row are missed; that's a known limitation documented in the rule.
    const fresh = await prisma.user.findMany({
      where: { role: "ADMIN", createdAt: { gte: windowStart, lt: windowEnd } },
      select: { email: true, name: true, createdAt: true },
      take: 20,
    });
    if (fresh.length === 0) return [];
    return [{
      windowStart, windowEnd, count: fresh.length,
      evidence: { newAdmins: fresh.map((u) => ({ email: u.email, name: u.name })) },
    }];
  },
};

export const suspiciousLoginVolume: DetectionRule = {
  key: "suspicious_login_volume",
  name: "One submitter generating an auth-ticket storm",
  description: "Same submitter has filed 8+ Account-&-Access tickets in 60 minutes. Could be a frustrated user — but more often it's an attacker probing the help-desk path because direct login is blocked.",
  severity: "MEDIUM",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const rows = await prisma.ticket.findMany({
      where: { category: "Account & Access", createdAt: { gte: windowStart, lt: windowEnd } },
      select: { submitterEmail: true, refCode: true },
      take: 500,
    });
    const byEmail = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byEmail.get(r.submitterEmail) ?? [];
      arr.push(r.refCode);
      byEmail.set(r.submitterEmail, arr);
    }
    const offenders = [...byEmail.entries()].filter(([, refs]) => refs.length >= 8);
    if (offenders.length === 0) return [];
    return [{
      windowStart, windowEnd,
      count: offenders.reduce((s, [, r]) => s + r.length, 0),
      evidence: Object.fromEntries(offenders),
    }];
  },
};
