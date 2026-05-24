/**
 * Phase 27 — Daily AI rule-study session.
 *
 * Triggered as part of the defender cron (right after the main run).
 * The study has its own narrower Claude tool-use loop. Its job:
 *
 *   1. Read the recent threat news + recent sensor alerts + the existing
 *      catalog of generated rules
 *   2. Find ATT&CK techniques mentioned in news / appearing in alerts
 *      that we don't yet have an APPROVED rule for
 *   3. Draft up to AI_RULE_STUDY_MAX_DRAFTS new rules per session
 *   4. For each draft: replay against history → write the testResults
 *   5. Leave drafts in TESTING status; humans approve in the UI
 *
 * Failure is silent — a bad study session shouldn't break the daily run.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages.js";

import { env } from "../env.js";
import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { validateRuleSpec, type RuleSpec } from "./dsl.js";
import { replayRule } from "./replay.js";

export interface StudyResult {
  iterations: number;
  newDraftsCreated: number;
  techniquesConsidered: number;
  error?: string;
}

const SYSTEM_PROMPT = `You are Relay's daily rule-study agent. You run after the daily
defender, with one job: study new attack techniques and propose detection rules.

Process:
  1. Use list_recent_news to see what's in the news.
  2. Use find_coverage_gaps to see which MITRE techniques we lack rules for.
  3. For up to 5 high-priority gaps, draft a new rule using draft_rule.
  4. For each draft, call test_rule to replay it against 30 days of sensor
     alerts. A draft with totalFires=0 in 30 days is too narrow; one with
     totalFires>500 is too broad — skip both extremes.
  5. Submit the surviving drafts via submit_draft (they enter TESTING
     status for human review in the UI).
  6. Call finish_study when done.

Rule DSL shape:
  {
    "match": { "mitreTechniqueId": "T1486", "minLevel": 7,
               "descriptionContains": "encrypt" },
    "window": { "minutes": 10 },
    "threshold": { "count": 3, "groupBy": "agentName" }
  }

Keep rules tight and explainable. Never call submit_draft without first
calling test_rule on it.`;

interface StudyCtx {
  organizationId: string;
  newDrafts: string[];
  finished: { value: boolean };
  techniquesConsidered: number;
}

const TOOLS: Tool[] = [
  {
    name: "list_recent_news",
    description: "Return the last 24h of NEWS-kind threat intel items.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "find_coverage_gaps",
    description: "Return ATT&CK techniques (a) referenced in recent sensor alerts or news AND (b) not already covered by an APPROVED rule. Returns up to 20.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "draft_rule",
    description: "Save a DRAFT rule. Returns the rule id. Does NOT activate it.",
    input_schema: {
      type: "object",
      properties: {
        mitreId:     { type: "string", description: "MITRE technique id this rule defends against" },
        title:       { type: "string" },
        description: { type: "string" },
        severity:    { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        logic:       { type: "object", description: "RuleSpec — see system prompt" },
        rationale:   { type: "string", description: "Why this rule, in 1-3 sentences" },
      },
      required: ["mitreId", "title", "description", "severity", "logic", "rationale"],
    },
  },
  {
    name: "test_rule",
    description: "Replay a draft rule against 30 days of sensor history. Returns totalFires, matchingAlerts, signalStrength.",
    input_schema: {
      type: "object",
      properties: { ruleId: { type: "string" } },
      required: ["ruleId"],
    },
  },
  {
    name: "submit_draft",
    description: "Move a tested draft from DRAFT → TESTING (pending human approval).",
    input_schema: {
      type: "object",
      properties: { ruleId: { type: "string" } },
      required: ["ruleId"],
    },
  },
  {
    name: "finish_study",
    description: "End the study session.",
    input_schema: { type: "object", properties: {} },
  },
];

export async function runRuleStudyForOrg(organizationId: string): Promise<StudyResult> {
  if (!env.AI_RULE_STUDY_ENABLED || !env.USE_AI_BRAIN || !env.ANTHROPIC_API_KEY) {
    return { iterations: 0, newDraftsCreated: 0, techniquesConsidered: 0, error: "AI rule study disabled" };
  }

  const ctx: StudyCtx = {
    organizationId, newDrafts: [], finished: { value: false }, techniquesConsidered: 0,
  };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages: MessageParam[] = [{
    role: "user",
    content: `You are the daily rule-study agent for organization ${organizationId}. ` +
      `You may draft at most ${env.AI_RULE_STUDY_MAX_DRAFTS} new rules in this session. ` +
      `Walk through your tools, then call finish_study.`,
  }];

  let iterations = 0;
  try {
    while (iterations < 12 && !ctx.finished.value) {
      iterations++;
      const resp = await client.messages.create({
        model: env.BRAIN_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
      messages.push({ role: "assistant", content: resp.content });
      const toolUses = resp.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break;

      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const tu of toolUses) {
        let result: unknown;
        try { result = await runStudyTool(tu.name, tu.input as Record<string, unknown>, ctx); }
        catch (err) { result = { error: (err as Error).message }; }
        toolResults.push({
          type: "tool_result", tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    return {
      iterations, newDraftsCreated: ctx.newDrafts.length,
      techniquesConsidered: ctx.techniquesConsidered,
      error: (err as Error).message,
    };
  }

  return {
    iterations,
    newDraftsCreated: ctx.newDrafts.length,
    techniquesConsidered: ctx.techniquesConsidered,
  };
}

async function runStudyTool(name: string, args: Record<string, unknown>, ctx: StudyCtx): Promise<unknown> {
  switch (name) {
    case "list_recent_news":   return listRecentNews();
    case "find_coverage_gaps": return findCoverageGaps(ctx);
    case "draft_rule":         return draftRule(args, ctx);
    case "test_rule":          return testRule(args, ctx);
    case "submit_draft":       return submitDraft(args, ctx);
    case "finish_study":       ctx.finished.value = true; return { ok: true };
    default:                   return { error: `unknown tool: ${name}` };
  }
}

async function listRecentNews(): Promise<unknown> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await basePrismaUnscoped.threatIntel.findMany({
    where: { kind: "NEWS", ingestedAt: { gte: since } },
    orderBy: { publishedAt: "desc" },
    take: 20,
    select: { id: true, title: true, description: true, severity: true, publishedAt: true },
  });
  return rows.map((r) => ({ ...r, description: r.description.slice(0, 400) }));
}

async function findCoverageGaps(ctx: StudyCtx): Promise<unknown> {
  return runWithTenant(ctx.organizationId, async () => {
    // Techniques referenced in recent sensor alerts (last 7 days).
    const alertCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const alertTechs = await prisma.sensorAlert.groupBy({
      by: ["mitreTechniqueId"],
      where: { createdAt: { gte: alertCutoff }, mitreTechniqueId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 50,
    });

    const candidateIds = alertTechs
      .map((t) => t.mitreTechniqueId).filter((s): s is string => Boolean(s));
    if (candidateIds.length === 0) {
      // Fallback: pick 5 high-priority MITRE techniques common in news.
      const techs = await basePrismaUnscoped.attackTechnique.findMany({
        where: { revoked: false, tactic: { in: ["execution", "credential-access", "impact"] } },
        orderBy: { modified: "desc" }, take: 10,
      });
      ctx.techniquesConsidered += techs.length;
      return techs.map((t) => ({ mitreId: t.mitreId, name: t.name, tactic: t.tactic, hasRule: false }));
    }

    const techs = await basePrismaUnscoped.attackTechnique.findMany({
      where: { mitreId: { in: candidateIds } },
      select: { id: true, mitreId: true, name: true, tactic: true },
    });
    const coveredApproved = await basePrismaUnscoped.generatedRule.findMany({
      where: {
        attackTechniqueId: { in: techs.map((t) => t.id) },
        status: "APPROVED",
        OR: [{ organizationId: null }, { organizationId: ctx.organizationId }],
      },
      select: { attackTechniqueId: true },
    });
    const coveredSet = new Set(coveredApproved.map((r) => r.attackTechniqueId));
    const gaps = techs.filter((t) => !coveredSet.has(t.id));
    ctx.techniquesConsidered += gaps.length;
    return gaps.slice(0, 10).map((t) => ({ mitreId: t.mitreId, name: t.name, tactic: t.tactic, hasRule: false }));
  });
}

async function draftRule(args: Record<string, unknown>, ctx: StudyCtx): Promise<unknown> {
  if (ctx.newDrafts.length >= env.AI_RULE_STUDY_MAX_DRAFTS) {
    return { error: `Draft quota exhausted (${env.AI_RULE_STUDY_MAX_DRAFTS}/session)` };
  }
  const mitreId = String(args.mitreId ?? "");
  if (!mitreId) return { error: "mitreId required" };
  let spec: RuleSpec;
  try { spec = validateRuleSpec(args.logic); }
  catch (err) { return { error: `Invalid RuleSpec: ${(err as Error).message}` }; }

  const tech = await basePrismaUnscoped.attackTechnique.findUnique({ where: { mitreId } });
  if (!tech) return { error: `unknown technique ${mitreId}` };

  const row = await basePrismaUnscoped.generatedRule.create({
    data: {
      organizationId: ctx.organizationId,
      attackTechniqueId: tech.id,
      title:       String(args.title ?? `${mitreId} detection`).slice(0, 200),
      description: String(args.description ?? "").slice(0, 2000),
      severity:    (String(args.severity ?? "MEDIUM").toUpperCase() as never),
      logic:       spec as unknown as object,
      rationale:   String(args.rationale ?? "").slice(0, 1000),
      createdBy:   "ai_daily_study",
      status:      "DRAFT",
    },
  });
  ctx.newDrafts.push(row.id);
  return { ok: true, ruleId: row.id };
}

async function testRule(args: Record<string, unknown>, ctx: StudyCtx): Promise<unknown> {
  const ruleId = String(args.ruleId ?? "");
  if (!ruleId) return { error: "ruleId required" };
  const rule = await basePrismaUnscoped.generatedRule.findUnique({ where: { id: ruleId } });
  if (!rule) return { error: "rule not found" };
  if (rule.organizationId && rule.organizationId !== ctx.organizationId) {
    return { error: "rule belongs to another org" };
  }
  const report = await replayRule(ctx.organizationId, rule.logic as unknown as RuleSpec);
  await basePrismaUnscoped.generatedRule.update({
    where: { id: ruleId },
    data: { testResults: report as unknown as object },
  });
  return report;
}

async function submitDraft(args: Record<string, unknown>, _ctx: StudyCtx): Promise<unknown> {
  const ruleId = String(args.ruleId ?? "");
  if (!ruleId) return { error: "ruleId required" };
  const r = await basePrismaUnscoped.generatedRule.findUnique({ where: { id: ruleId } });
  if (!r) return { error: "rule not found" };
  // Require test results before promoting.
  const tr = r.testResults as Record<string, unknown> | undefined;
  if (!tr || typeof tr.totalFires !== "number") {
    return { error: "rule must be tested first" };
  }
  await basePrismaUnscoped.generatedRule.update({
    where: { id: ruleId },
    data: { status: "TESTING" },
  });
  return { ok: true };
}
