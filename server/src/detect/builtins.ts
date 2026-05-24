/**
 * Phase 12 — Built-in detection rules.
 *
 * Each rule is a small, focused guard that scans recent activity and fires
 * a DetectionHit when its threshold is crossed. Rules can be enabled/disabled
 * per org via Organization.settings.disabledDetectionRules.
 *
 * Adding a rule: implement the shape from ./types.ts and register it in
 * ./registry.ts. Keep windows + thresholds reasonable — false positives
 * are the enemy of an alerting system.
 */

import { alignWindowStart, type DetectionRule } from "./types.js";

// ─── Ticket-pattern rules ────────────────────────────────────────────

/**
 * 5+ Security-category tickets within a 10-minute window. Classic spike-detection
 * signature for ransomware deployment / phishing campaign / mass credential
 * stuffing.
 */
export const securityBurst: DetectionRule = {
  key: "security_burst",
  name: "Security ticket spike",
  description: "5 or more Security-category tickets opened within a 10-minute window — often the leading edge of a phishing wave, ransomware, or credential-stuffing attack.",
  severity: "HIGH",
  windowMinutes: 10,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 10);
    const windowEnd = new Date(windowStart.getTime() + 10 * 60 * 1000);
    const tickets = await prisma.ticket.findMany({
      where: { category: "Security", createdAt: { gte: windowStart, lt: windowEnd } },
      select: { id: true, refCode: true, submitterEmail: true, description: true },
      take: 50,
    });
    if (tickets.length < 5) return [];
    return [{
      windowStart, windowEnd,
      count: tickets.length,
      evidence: {
        sampleRefCodes: tickets.slice(0, 10).map((t) => t.refCode),
        distinctSubmitters: new Set(tickets.map((t) => t.submitterEmail)).size,
      },
    }];
  },
};

/**
 * Tickets whose description suggests active ransomware ("encrypted", "ransom",
 * ".locked extension"). One hit at CRITICAL is enough — better a false positive
 * than missing it.
 */
export const ransomwareLanguage: DetectionRule = {
  key: "ransomware_language",
  name: "Ransomware language detected",
  description: "A ticket mentions ransom notes, file encryption or locked extensions. Fires immediately on a single match — escalates straight to ops.",
  severity: "CRITICAL",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const pattern = /(ransom|encrypt(ed|ing)|\.locked|files? are (locked|encrypted)|pay\s+in\s+(bitcoin|crypto))/i;
    const candidates = await prisma.ticket.findMany({
      where: { createdAt: { gte: windowStart, lt: windowEnd } },
      select: { id: true, refCode: true, description: true },
      take: 200,
    });
    const matches = candidates.filter((c) => pattern.test(c.description));
    if (matches.length === 0) return [];
    return [{
      windowStart, windowEnd, count: matches.length,
      evidence: {
        refCodes: matches.map((m) => m.refCode),
        snippets: matches.map((m) => m.description.slice(0, 140)),
      },
    }];
  },
};

/**
 * 3+ MFA-reset / MFA-bypass tickets from the same submitter inside 1 hour.
 * Could be a user struggling, but more often it's an attacker working through
 * a compromised inbox.
 */
export const mfaBruteForce: DetectionRule = {
  key: "mfa_brute_force",
  name: "Repeated MFA reset attempts",
  description: "Same submitter has filed 3 or more MFA-related tickets within an hour. Could be a help-desk social-engineering attempt against the MFA reset flow.",
  severity: "HIGH",
  windowMinutes: 60,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 60);
    const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const rows = await prisma.ticket.findMany({
      where: {
        createdAt: { gte: windowStart, lt: windowEnd },
        description: { contains: "mfa", mode: "insensitive" },
      },
      select: { submitterEmail: true, refCode: true },
      take: 300,
    });
    const byEmail = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byEmail.get(r.submitterEmail) ?? [];
      arr.push(r.refCode);
      byEmail.set(r.submitterEmail, arr);
    }
    const offenders = [...byEmail.entries()].filter(([, refs]) => refs.length >= 3);
    if (offenders.length === 0) return [];
    return [{
      windowStart, windowEnd,
      count: offenders.reduce((sum, [, r]) => sum + r.length, 0),
      evidence: Object.fromEntries(offenders),
    }];
  },
};

// ─── Runbook-health rules ───────────────────────────────────────────

/**
 * 3+ FAILED RunbookExecution rows for the same runbook key inside 30 minutes.
 * Suggests an environmental issue or a regression in the runbook itself —
 * stop fanning it out until someone looks.
 */
export const runbookFailureSpike: DetectionRule = {
  key: "runbook_failure_spike",
  name: "Runbook failing repeatedly",
  description: "The same runbook key has FAILED 3 or more times in the last 30 minutes. Likely a regression in the runbook code or an outage in its dependency.",
  severity: "MEDIUM",
  windowMinutes: 30,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 30);
    const windowEnd = new Date(windowStart.getTime() + 30 * 60 * 1000);
    const groups = await prisma.runbookExecution.groupBy({
      by: ["runbookKey"],
      where: { status: "FAILED", startedAt: { gte: windowStart, lt: windowEnd } },
      _count: { _all: true },
    });
    const offenders = groups.filter((g) => g._count._all >= 3);
    if (offenders.length === 0) return [];
    return [{
      windowStart, windowEnd,
      count: offenders.reduce((sum, g) => sum + g._count._all, 0),
      evidence: { offenders: offenders.map((g) => ({ runbookKey: g.runbookKey, count: g._count._all })) },
    }];
  },
};

// ─── Device-fleet rules ─────────────────────────────────────────────

/**
 * 5+ critical-health devices across the org. Means something fleet-wide is
 * actively degrading (push update gone wrong, network partition, etc.).
 */
export const fleetDegradation: DetectionRule = {
  key: "fleet_degradation",
  name: "Fleet-wide device degradation",
  description: "5+ devices are currently CRITICAL in this organisation. Likely a push update gone wrong, network partition, or shared dependency failure.",
  severity: "HIGH",
  windowMinutes: 15,
  async detect({ prisma, now }) {
    const windowStart = alignWindowStart(now, 15);
    const windowEnd = new Date(windowStart.getTime() + 15 * 60 * 1000);
    const critical = await prisma.device.count({ where: { healthStatus: "CRITICAL" } });
    if (critical < 5) return [];
    const sample = await prisma.device.findMany({
      where: { healthStatus: "CRITICAL" }, select: { hostname: true }, take: 10,
    });
    return [{
      windowStart, windowEnd,
      count: critical,
      evidence: { sampleHostnames: sample.map((s) => s.hostname) },
    }];
  },
};
