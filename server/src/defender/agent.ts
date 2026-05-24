/**
 * Phase 26 — Daily defender agent (Claude tool-use loop).
 *
 * Reads the situation report, drives a tool-use conversation with Claude,
 * persists every step as a `DefenderRun` row. Designed to be cheap and
 * bounded:
 *   • DEFENDER_MAX_ITERATIONS caps the round-trip count (default 20).
 *   • One write_briefing + one finish are the expected exit shape;
 *     hitting the iteration cap saves a HALTED row with whatever was
 *     produced so far.
 *
 * The agent is OPT-IN — without `USE_AI_BRAIN=true` + `ANTHROPIC_API_KEY`
 * the run records a synthetic briefing built from the situation alone
 * (so the cron still produces an artefact every day).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam, Tool, ToolUseBlock, TextBlock,
} from "@anthropic-ai/sdk/resources/messages.js";

import { env } from "../env.js";
import { basePrismaUnscoped } from "../db.js";
import { buildSituation } from "./situation.js";
import { TOOL_DESCRIPTORS, runTool, type ToolCtx } from "./tools.js";
import type { DefenderDecision, ToolCallRecord } from "./types.js";

export interface RunOpts {
  /** Override "today" — used by tests + manual replays. */
  runDate?: Date;
}

export interface RunResult {
  defenderRunId: string;
  status: "SUCCEEDED" | "FAILED" | "HALTED";
  iterations: number;
  decisions: DefenderDecision[];
  briefing: string;
}

const SYSTEM_PROMPT = `You are Relay's daily defender agent. You run once per day, per
customer organisation, with one job: review the last 24 hours of threat intelligence,
correlate against this organisation's specific posture, and decide what to do.

You have tools to:
  • read intel + matches (search_threat_intel, list_open_matches, get_intel_detail)
  • read fleet inventory (get_fleet_snapshot, list_runbooks)
  • take actions (open_ticket_from_match, acknowledge_match, dismiss_match, recommend_runbook)
  • finish with a Markdown briefing (write_briefing, finish)

Your goals, in order:
  1. SAFETY — never dismiss a CRITICAL or KEV-listed match. Open a ticket instead.
  2. SIGNAL — for every open match, decide: ticket / ack / dismiss / recommend a runbook.
     "Ack" means "I saw it and it's handled or background-noise". "Dismiss" means
     "false positive — does not apply to us" (be very strict before dismissing).
  3. CLARITY — write a tight Markdown briefing (≤800 words) summarising the day's
     threat landscape AS IT APPLIES TO THIS ORG SPECIFICALLY, your decisions,
     and any one-line recommendations for tomorrow.

You will be evaluated next day on:
  • Did the tickets you opened get resolved? (good — signals justified)
  • Did anything you dismissed re-fire on a new feed? (bad — signals false negative)

Be decisive. Don't ask questions. Don't print prose outside write_briefing.`;

export async function runDefenderForOrg(organizationId: string, opts: RunOpts = {}): Promise<RunResult> {
  const runDate = opts.runDate ?? new Date();
  // Truncate runDate to the UTC date — one defender run per (org, day).
  const runDateUTC = new Date(Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate()));

  // Create / upsert the DefenderRun row first so a crash leaves an audit trail.
  const situation = await buildSituation(organizationId, runDate);
  const row = await basePrismaUnscoped.defenderRun.upsert({
    where: { organizationId_runDate: { organizationId, runDate: runDateUTC } },
    create: {
      organizationId, runDate: runDateUTC,
      status: "RUNNING",
      situation: situation as unknown as object,
    },
    update: {
      status: "RUNNING",
      situation: situation as unknown as object,
      toolCalls: [] as unknown as object,
      decisions: [] as unknown as object,
      briefing: null, completedAt: null, errorReason: null, iterations: 0,
    },
  });

  // Run the agent.
  const ctx: ToolCtx = {
    organizationId,
    decisions: [],
    briefing: { markdown: "" },
    finished: { value: false },
  };
  const toolCalls: ToolCallRecord[] = [];

  let status: RunResult["status"] = "FAILED";
  let iterations = 0;
  let errorReason: string | null = null;

  try {
    const useAi = env.USE_AI_BRAIN && env.ANTHROPIC_API_KEY;
    if (!useAi) {
      // No AI configured — render a synthetic briefing from the situation.
      ctx.briefing.markdown = renderSyntheticBriefing(situation);
      status = "SUCCEEDED";
    } else {
      const r = await runClaudeLoop(situation, ctx, toolCalls);
      iterations = r.iterations;
      status = r.status;
    }
  } catch (err) {
    errorReason = (err as Error).message ?? String(err);
    status = "FAILED";
  }

  await basePrismaUnscoped.defenderRun.update({
    where: { id: row.id },
    data: {
      status, iterations,
      toolCalls: toolCalls as unknown as object,
      decisions: ctx.decisions as unknown as object,
      briefing: ctx.briefing.markdown || null,
      errorReason,
      completedAt: new Date(),
    },
  });

  return {
    defenderRunId: row.id,
    status, iterations,
    decisions: ctx.decisions,
    briefing: ctx.briefing.markdown,
  };
}

// ─── Internals ───────────────────────────────────────────────────────

async function runClaudeLoop(
  situation: Awaited<ReturnType<typeof buildSituation>>,
  ctx: ToolCtx,
  toolCalls: ToolCallRecord[],
): Promise<{ status: RunResult["status"]; iterations: number }> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const tools: Tool[] = TOOL_DESCRIPTORS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as unknown as Tool["input_schema"],
  }));

  const initialUser: MessageParam = {
    role: "user",
    content:
      `Today is ${situation.runDate}. Here is the situation report for org ${situation.organizationId}:\n\n` +
      "```json\n" + JSON.stringify(situation, null, 2) + "\n```\n\n" +
      "Decide what to do, then call write_briefing + finish.",
  };
  const messages: MessageParam[] = [initialUser];

  let iterations = 0;
  while (iterations < env.DEFENDER_MAX_ITERATIONS) {
    iterations++;
    const resp = await client.messages.create({
      model: env.BRAIN_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    // Push the assistant turn into the conversation.
    messages.push({ role: "assistant", content: resp.content });

    // Walk every tool_use block and run it.
    const toolUseBlocks = resp.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );
    if (toolUseBlocks.length === 0) {
      // Assistant stopped without calling a tool — done if it also wrote
      // a briefing already, otherwise treat as halted.
      return { status: ctx.briefing.markdown ? "SUCCEEDED" : "HALTED", iterations };
    }

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const tu of toolUseBlocks) {
      const args = (tu.input ?? {}) as Record<string, unknown>;
      let result: unknown;
      try { result = await runTool(tu.name, args, ctx); }
      catch (err) { result = { error: (err as Error).message ?? String(err) }; }
      toolCalls.push({ tool: tu.name, args, result, ts: new Date().toISOString() });
      toolResults.push({
        type: "tool_result", tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }
    messages.push({ role: "user", content: toolResults });

    if (ctx.finished.value) {
      return { status: ctx.briefing.markdown ? "SUCCEEDED" : "HALTED", iterations };
    }
  }
  return { status: "HALTED", iterations };
}

/** Used when AI is off — we still produce a briefing so the cron has output. */
function renderSyntheticBriefing(s: Awaited<ReturnType<typeof buildSituation>>): string {
  const lines: string[] = [];
  lines.push(`# Daily defender briefing — ${s.runDate}`);
  lines.push("");
  lines.push("_AI brain is disabled (USE_AI_BRAIN=false). This briefing is a template, not an agentic analysis._");
  lines.push("");
  lines.push(`## Fleet`);
  lines.push(`- ${s.fleet.deviceCount} devices total · ${s.fleet.criticalDeviceCount} critical-health · ${s.fleet.staleDeviceCount} stale (no check-in in 1h)`);
  lines.push(`- OS mix: ${Object.entries(s.fleet.osBreakdown).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  lines.push("");
  lines.push(`## New threat intel (last ${s.windowHours}h)`);
  lines.push(`- ${s.threatIntel.newKevCount} KEV · ${s.threatIntel.newCveCount} CVE · ${s.threatIntel.newAdvisoryCount} advisory · ${s.threatIntel.newNewsCount} news`);
  if (s.threatIntel.topItems.length > 0) {
    lines.push("");
    lines.push("### Top items");
    for (const t of s.threatIntel.topItems) lines.push(`- **[${t.severity}]** ${t.externalId} (${t.source}) — ${t.title}`);
  }
  lines.push("");
  lines.push(`## Open matches against your fleet`);
  lines.push(`- ${s.threatMatches.openCount} open · ${s.threatMatches.criticalCount} critical`);
  if (s.threatMatches.topMatches.length > 0) {
    lines.push("");
    for (const m of s.threatMatches.topMatches) lines.push(`- **[${m.severity}]** ${m.cveId} — ${m.reason}`);
  }
  if (s.detections.newHitsCount > 0) {
    lines.push("");
    lines.push(`## Detections fired today: ${s.detections.newHitsCount}`);
    for (const h of s.detections.topHits) lines.push(`- **[${h.severity}]** ${h.ruleKey} (count ${h.count})`);
  }
  if (s.previousRun) {
    lines.push("");
    lines.push(`## Previous run outcomes`);
    lines.push(`- decisions made: ${s.previousRun.decisionsMade}`);
    lines.push(`- tickets opened: ${s.previousRun.ticketsOpened} · resolved: ${s.previousRun.ticketsResolved}`);
    lines.push(`- dismissed-then-re-fired: ${s.previousRun.dismissedThenRefired}`);
  }
  return lines.join("\n");
}
