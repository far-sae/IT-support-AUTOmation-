/**
 * Phase 26 — Tools the defender agent can invoke during a run.
 *
 * Each tool is plain async TypeScript. The Claude tool-use loop in
 * `agent.ts` exposes them with a JSON-schema-ish description and routes
 * the LLM's tool_use blocks to these functions. Tools enforce their own
 * tenant scoping via `runWithTenant`.
 *
 * Tools fall into three categories:
 *   • READ  — search threat intel, list matches, get fleet snapshot
 *   • WRITE — open ticket, ack/dismiss match
 *   • META  — finish + write_briefing
 *
 * Writes always go through `runWithTenant(organizationId, ...)` so the
 * agent cannot leak across tenants even if it tried.
 */

import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { RUNBOOKS } from "../runbooks/registry.js";
import type { DefenderDecision } from "./types.js";

export interface ToolCtx {
  organizationId: string;
  /** Defender accumulates concrete decisions for the audit trail. */
  decisions: DefenderDecision[];
  /** A short user-facing briefing the agent writes as its final tool call. */
  briefing: { markdown: string };
  /** Set to true once the agent calls `finish` so the loop exits cleanly. */
  finished: { value: boolean };
}

// ─── Tool descriptors (Anthropic tool-use schema) ────────────────────

export interface ToolDescriptor {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: "search_threat_intel",
    description: "Search ingested threat-intel items. Filters: kind (CVE|KEV|ADVISORY|NEWS), severity (LOW|MEDIUM|HIGH|CRITICAL), days_back (default 1).",
    input_schema: {
      type: "object",
      properties: {
        kind:     { type: "string", description: "Optional kind filter" },
        severity: { type: "string", description: "Optional severity filter" },
        days_back:{ type: "number", description: "How many days to look back (default 1)" },
        limit:    { type: "number", description: "Max items to return (default 20)" },
      },
    },
  },
  {
    name: "list_open_matches",
    description: "List the org's currently-open ThreatMatch rows (CVEs correlated against your devices). Returns id, cveId, severity, reason, device count.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "get_intel_detail",
    description: "Fetch the full record for one ThreatIntel item (by id). Returns description, references, affected products, KEV metadata.",
    input_schema: {
      type: "object",
      properties: { intelId: { type: "string" } }, required: ["intelId"],
    },
  },
  {
    name: "get_fleet_snapshot",
    description: "Return the org's device inventory grouped by OS + health status.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_runbooks",
    description: "List available runbook keys + their risk levels. Use this to recommend a runbook for a specific match.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "open_ticket_from_match",
    description: "Convert a ThreatMatch into a Security ticket. Use for HIGH/CRITICAL findings where action is needed today.",
    input_schema: {
      type: "object",
      properties: {
        matchId:  { type: "string" },
        priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
        reason:   { type: "string", description: "One-sentence justification for the human reader." },
      },
      required: ["matchId", "priority", "reason"],
    },
  },
  {
    name: "acknowledge_match",
    description: "Mark a match as acknowledged (read but not actioned — known/handled).",
    input_schema: {
      type: "object",
      properties: { matchId: { type: "string" }, reason: { type: "string" } },
      required: ["matchId", "reason"],
    },
  },
  {
    name: "dismiss_match",
    description: "Dismiss a match as not-applicable. Use sparingly — false negatives hurt next-day learning.",
    input_schema: {
      type: "object",
      properties: { matchId: { type: "string" }, reason: { type: "string" } },
      required: ["matchId", "reason"],
    },
  },
  {
    name: "recommend_runbook",
    description: "Flag a runbook as the recommended response for a match (doesn't dispatch — humans approve).",
    input_schema: {
      type: "object",
      properties: { matchId: { type: "string" }, runbookKey: { type: "string" }, reason: { type: "string" } },
      required: ["matchId", "runbookKey", "reason"],
    },
  },
  {
    name: "write_briefing",
    description: "Write the final Markdown briefing summarising today's threat posture + actions. Call this exactly once before `finish`. Keep under 800 words.",
    input_schema: {
      type: "object",
      properties: { markdown: { type: "string" } },
      required: ["markdown"],
    },
  },
  {
    name: "finish",
    description: "End the defender run. Call after `write_briefing`.",
    input_schema: { type: "object", properties: {} },
  },
];

// ─── Tool implementations ────────────────────────────────────────────

export async function runTool(
  name: string, args: Record<string, unknown>, ctx: ToolCtx,
): Promise<unknown> {
  switch (name) {
    case "search_threat_intel":      return searchThreatIntel(args);
    case "list_open_matches":        return listOpenMatches(args, ctx);
    case "get_intel_detail":         return getIntelDetail(args);
    case "get_fleet_snapshot":       return getFleetSnapshot(ctx);
    case "list_runbooks":            return listRunbooks();
    case "open_ticket_from_match":   return openTicketFromMatch(args, ctx);
    case "acknowledge_match":        return acknowledgeMatch(args, ctx);
    case "dismiss_match":            return dismissMatch(args, ctx);
    case "recommend_runbook":        return recommendRunbook(args, ctx);
    case "write_briefing":           return writeBriefing(args, ctx);
    case "finish":                   return finish(ctx);
    default:                         return { error: `unknown tool: ${name}` };
  }
}

async function searchThreatIntel(args: Record<string, unknown>): Promise<unknown> {
  const days   = Math.max(1, Math.min(30, Number(args.days_back) || 1));
  const limit  = Math.max(1, Math.min(100, Number(args.limit) || 20));
  const kind   = typeof args.kind === "string" ? args.kind.toUpperCase() : undefined;
  const severity = typeof args.severity === "string" ? args.severity.toUpperCase() : undefined;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await basePrismaUnscoped.threatIntel.findMany({
    where: {
      ingestedAt: { gte: since },
      ...(kind ? { kind: kind as never } : {}),
      ...(severity ? { severity: severity as never } : {}),
    },
    orderBy: [{ severity: "desc" }, { publishedAt: "desc" }],
    take: limit,
    select: { id: true, kind: true, severity: true, source: true, externalId: true, title: true, cvss: true, publishedAt: true },
  });
  return { count: rows.length, items: rows };
}

async function listOpenMatches(args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
  return runWithTenant(ctx.organizationId, async () => {
    const rows = await prisma.threatMatch.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { threatIntel: { select: { externalId: true, severity: true, kind: true, title: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      cveId: m.threatIntel.externalId,
      severity: m.threatIntel.severity,
      kind: m.threatIntel.kind,
      title: m.threatIntel.title.slice(0, 200),
      reason: m.reason,
      evidence: m.evidence,
    }));
  });
}

async function getIntelDetail(args: Record<string, unknown>): Promise<unknown> {
  const id = String(args.intelId ?? "");
  if (!id) return { error: "intelId is required" };
  const row = await basePrismaUnscoped.threatIntel.findUnique({ where: { id } });
  if (!row) return { error: `intel ${id} not found` };
  return row;
}

async function getFleetSnapshot(ctx: ToolCtx): Promise<unknown> {
  return runWithTenant(ctx.organizationId, async () => {
    const devices = await prisma.device.findMany({
      select: { id: true, hostname: true, os: true, healthStatus: true, agentVersion: true },
    });
    const byOs: Record<string, number> = {};
    const byHealth: Record<string, number> = { HEALTHY: 0, WARNING: 0, CRITICAL: 0 };
    for (const d of devices) {
      const os = (d.os ?? "unknown").split(/\s+/).slice(0, 2).join(" ");
      byOs[os] = (byOs[os] ?? 0) + 1;
      byHealth[d.healthStatus] = (byHealth[d.healthStatus] ?? 0) + 1;
    }
    return { total: devices.length, byOs, byHealth };
  });
}

function listRunbooks(): unknown {
  return RUNBOOKS.map((r) => ({ key: r.key, name: r.name, risk: r.risk }));
}

async function openTicketFromMatch(args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  const matchId  = String(args.matchId ?? "");
  const priority = String(args.priority ?? "High");
  const reason   = String(args.reason ?? "");
  if (!matchId) return { error: "matchId required" };

  return runWithTenant(ctx.organizationId, async () => {
    const m = await prisma.threatMatch.findUnique({
      where: { id: matchId }, include: { threatIntel: true },
    });
    if (!m) return { error: `match ${matchId} not found` };
    if (m.resultingTicketId) return { error: "match already converted to a ticket", existingTicketId: m.resultingTicketId };

    const desc = `[Defender] ${m.threatIntel.title}\n\nReason for opening: ${reason}\n\n` +
                 `Original match reason: ${m.reason}\n\n` +
                 `Intel description:\n${m.threatIntel.description.slice(0, 1500)}`;
    const ticket = await prisma.ticket.create({
      data: {
        organizationId: ctx.organizationId,
        refCode: `INC-${Date.now().toString().slice(-7)}`,
        description: desc.slice(0, 4000),
        source: "PORTAL",
        submitterName: "Daily defender agent",
        submitterEmail: "defender@relay",
        category: "Security", priority,
        assignedTeam: "Security",
        slaTarget: "1 business day",
        slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        confidence: 1.0, status: "OPEN", autoReply: "",
      },
    });
    await prisma.threatMatch.update({
      where: { id: matchId },
      data: { status: "CONVERTED_TO_TICKET", resultingTicketId: ticket.id },
    });
    ctx.decisions.push({
      kind: "open_ticket", matchId, ticketId: ticket.id,
      refCode: ticket.refCode, priority, reason,
    });
    return { ok: true, ticketId: ticket.id, refCode: ticket.refCode };
  });
}

async function acknowledgeMatch(args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  const matchId = String(args.matchId ?? "");
  const reason  = String(args.reason ?? "");
  if (!matchId) return { error: "matchId required" };
  return runWithTenant(ctx.organizationId, async () => {
    await prisma.threatMatch.update({
      where: { id: matchId },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedBy: "defender" },
    });
    ctx.decisions.push({ kind: "ack_match", matchId, reason });
    return { ok: true };
  });
}

async function dismissMatch(args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  const matchId = String(args.matchId ?? "");
  const reason  = String(args.reason ?? "");
  if (!matchId) return { error: "matchId required" };
  return runWithTenant(ctx.organizationId, async () => {
    await prisma.threatMatch.update({
      where: { id: matchId },
      data: { status: "DISMISSED", acknowledgedAt: new Date(), acknowledgedBy: "defender" },
    });
    ctx.decisions.push({ kind: "dismiss_match", matchId, reason });
    return { ok: true };
  });
}

function recommendRunbook(args: Record<string, unknown>, ctx: ToolCtx): unknown {
  const matchId    = String(args.matchId ?? "");
  const runbookKey = String(args.runbookKey ?? "");
  const reason     = String(args.reason ?? "");
  if (!matchId || !runbookKey) return { error: "matchId + runbookKey required" };
  if (!RUNBOOKS.some((r) => r.key === runbookKey)) return { error: `unknown runbook key '${runbookKey}'` };
  ctx.decisions.push({ kind: "recommend_runbook", matchId, runbookKey, reason });
  return { ok: true };
}

function writeBriefing(args: Record<string, unknown>, ctx: ToolCtx): unknown {
  const md = String(args.markdown ?? "");
  if (!md || md.length < 50) return { error: "Briefing must be at least 50 chars of Markdown." };
  ctx.briefing.markdown = md.slice(0, 20_000);
  return { ok: true, length: md.length };
}

function finish(ctx: ToolCtx): unknown {
  ctx.finished.value = true;
  return { ok: true };
}
