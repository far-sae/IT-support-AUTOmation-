/**
 * Tools the autopilot brain can call.
 *
 * Each tool is a thin wrapper around an existing Relay capability — the
 * Prisma extension keeps everything tenant-scoped because the brain runs
 * inside the ticket's tenant ALS context.
 *
 * Tool definitions follow Anthropic's tool-use schema:
 *   { name, description, input_schema (JSON Schema) }
 */

import type { Ticket } from "@prisma/client";

import { prisma } from "../db.js";
import { RUNBOOKS, getRunbook } from "../runbooks/registry.js";
import { runRunbook, type PickResult } from "../runbooks/engine.js";
import { triage as ruleTriage } from "../triage.js";
import { signatureOf, statsForSignature } from "../learning/store.js";
import { searchSimilar } from "../memory/store.js";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

export const TOOLS: ToolDef[] = [
  {
    name: "search_kb",
    description: "Search the organisation's knowledge base for articles matching a query. Returns title + summary + step count for up to 5 matches.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Free-text search query" } },
      required: ["query"],
    },
  },
  {
    name: "list_runbooks",
    description: "List runbooks available for this organisation. Returns key, name, risk, and the historical success/failure counts at this ticket's signature.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_device_metrics",
    description: "Fetch the most recent CPU/RAM/disk metrics for the device whose hostname is given. Returns the latest 5 samples.",
    input_schema: {
      type: "object",
      properties: { hostname: { type: "string" } },
      required: ["hostname"],
    },
  },
  {
    name: "query_similar_tickets",
    description: "Look up previous tickets in this org with similar wording. Returns up to 5 with their resolution, so the brain can reuse past fixes.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "execute_runbook",
    description: "Run a runbook by key. Returns its outcome immediately. Use this when you've decided which fix to try. The system handles posting comments + closing the ticket.",
    input_schema: {
      type: "object",
      properties: {
        runbook_key: { type: "string", description: "From list_runbooks" },
      },
      required: ["runbook_key"],
    },
  },
  {
    name: "post_comment",
    description: "Post a comment on the current ticket. Use for status updates the user should see, or for internal notes (set internal=true).",
    input_schema: {
      type: "object",
      properties: {
        body: { type: "string" },
        internal: { type: "boolean", default: false },
      },
      required: ["body"],
    },
  },
  {
    name: "escalate",
    description: "Hand the ticket off to a human agent. Use when no runbook matches with confidence, or when an attempted fix failed verification.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "finish",
    description: "Call this when you're done with the ticket — either because a runbook is running, or you've escalated, or no further action is needed.",
    input_schema: { type: "object", properties: {} },
  },
];

export interface ToolContext {
  ticket: Ticket;
  authorId: string; // user id used for posted comments (the submitter or fallback admin)
}

export type ToolResult = { content: string } | { content: string; isError: true };

// ─── Executors ──────────────────────────────────────────────────────

export async function searchKb(query: string): Promise<ToolResult> {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  const articles = await prisma.kbArticle.findMany({
    orderBy: { helpedCount: "desc" },
    take: 50,
    select: { id: true, title: true, category: true, summary: true, keywords: true, steps: true, helpedCount: true },
  });
  const scored = articles
    .map((a) => {
      const corpus = (a.title + " " + a.summary).toLowerCase() + " " +
        (Array.isArray(a.keywords) ? (a.keywords as unknown as string[]).join(" ").toLowerCase() : "");
      let score = 0;
      for (const t of tokens) if (corpus.includes(t)) score += 1;
      return { ...a, score };
    })
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (scored.length === 0) return { content: "(no matches)" };
  return {
    content: scored
      .map((a) => `• ${a.title} (${a.category}, ${Array.isArray(a.steps) ? (a.steps as unknown[]).length : 0} steps, ${a.helpedCount} helped): ${a.summary}`)
      .join("\n"),
  };
}

export async function listRunbooks(ticket: Ticket): Promise<ToolResult> {
  const triage = ruleTriage(ticket.description);
  const sig = signatureOf(triage, ticket.description);
  const stats = await statsForSignature(ticket.organizationId, sig);
  const lines = RUNBOOKS.map((rb) => {
    const s = stats[rb.key];
    const hist = s
      ? `${s.successes}/${s.attempts} succeeded (${(s.successRate * 100).toFixed(0)}%)`
      : "no history";
    return `• ${rb.key} (${rb.risk}) — ${rb.name}  [${hist}]`;
  });
  return { content: lines.join("\n") };
}

export async function getDeviceMetrics(orgId: string, hostname: string): Promise<ToolResult> {
  const device = await prisma.device.findFirst({ where: { hostname } });
  if (!device) return { content: `(no device named ${hostname})` };
  const metrics = await prisma.deviceMetric.findMany({
    where: { deviceId: device.id },
    orderBy: { recordedAt: "desc" },
    take: 5,
    select: { recordedAt: true, cpu: true, ram: true, disk: true },
  });
  if (metrics.length === 0) return { content: `${hostname}: no telemetry yet` };
  void orgId;
  return {
    content:
      `${hostname} (${device.healthStatus})\n` +
      metrics.map((m) => `  ${m.recordedAt.toISOString()}  cpu=${m.cpu}% ram=${m.ram}% disk=${m.disk}%`).join("\n"),
  };
}

export async function querySimilarTickets(orgId: string, query: string, category = "Software"): Promise<ToolResult> {
  void orgId;
  // Phase 11 — vector memory search.
  const memories = await searchSimilar({ description: query, category, k: 5 });
  if (memories.length === 0) return { content: "(no similar resolved tickets in memory)" };
  return {
    content: memories
      .map((m) =>
        `• ${m.refCode} (${m.category}, sim ${m.similarity.toFixed(2)})` +
        (m.winningRunbook ? `  → fix: ${m.winningRunbook}` : "  → (no runbook fix recorded)"),
      )
      .join("\n"),
  };
}

export interface ExecuteResult {
  outcome: "SUCCEEDED" | "AWAITING_VERIFICATION" | "FAILED";
  runbookKey: string;
  message: string;
}

/**
 * Synchronously run a chosen runbook through the existing engine. Returns
 * a structured summary so the brain can decide whether to call finish()
 * or try something else.
 */
export async function executeRunbook(
  ctx: ToolContext,
  runbookKey: string,
): Promise<ToolResult & { meta?: ExecuteResult }> {
  const runbook = getRunbook(runbookKey);
  if (!runbook) {
    return { content: `(no runbook named ${runbookKey})`, isError: true };
  }
  const triage = ruleTriage(ctx.ticket.description);
  const pick: PickResult = {
    runbook,
    confidence: 0.9, // brain's call — we trust it
    reason: "brain-selected",
  };
  await runRunbook({ ticket: ctx.ticket, triage }, pick);

  // Inspect the created/updated execution to report status back.
  const exec = await prisma.runbookExecution.findFirst({
    where: { ticketId: ctx.ticket.id, runbookKey: runbook.key },
    orderBy: { startedAt: "desc" },
  });
  const status = exec?.status === "SUCCEEDED"
    ? "SUCCEEDED" as const
    : exec?.status === "FAILED" || exec?.status === "CANCELLED"
      ? "FAILED" as const
      : "AWAITING_VERIFICATION" as const;
  return {
    content: `Ran ${runbook.key}. Outcome: ${exec?.status ?? "UNKNOWN"}.`,
    meta: { outcome: status, runbookKey: runbook.key, message: `status=${exec?.status}` },
  };
}

export async function postComment(
  ctx: ToolContext,
  body: string,
  internal: boolean,
): Promise<ToolResult> {
  await prisma.comment.create({
    data: {
      organizationId: ctx.ticket.organizationId,
      ticketId: ctx.ticket.id,
      authorId: ctx.authorId,
      body,
      isInternal: internal,
    },
  });
  return { content: "comment posted" };
}

export async function escalate(ctx: ToolContext, reason: string): Promise<ToolResult> {
  await prisma.comment.create({
    data: {
      organizationId: ctx.ticket.organizationId,
      ticketId: ctx.ticket.id,
      authorId: ctx.authorId,
      body: `[Autopilot] Escalating to a human agent. Reason: ${reason}`,
      isInternal: false,
    },
  });
  // Leave the ticket OPEN/IN_PROGRESS — a human picks it up.
  return { content: "escalated" };
}
