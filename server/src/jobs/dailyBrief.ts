/**
 * Phase 11 — Daily AI brief.
 *
 * Once per day per organization, generate a Markdown briefing covering the
 * last 24 h:
 *   • Tickets opened / resolved
 *   • Autopilot win rate per runbook
 *   • SLA breaches
 *   • Devices that went CRITICAL
 *   • Notable agent actions
 *   • Top runbooks the brain leaned on
 *
 * If `USE_AI_BRAIN=true` + `ANTHROPIC_API_KEY` set, Claude writes a brief
 * intro + tomorrow's recommendations in natural language. Otherwise we
 * template-fill so the brief still ships.
 *
 * Output:
 *   • A `DailyBrief` row stored against the org (one per day)
 *   • Email to every ADMIN
 *   • Slack post (if a webhook is configured)
 */

import cron from "node-cron";
import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { sendMail } from "../email/mailer.js";
import { notifySlackBrief } from "../notifications/slack.js";

export interface BriefStats {
  ticketsOpened: number;
  ticketsResolved: number;
  autoResolvedByBrain: number;
  slaBreached: number;
  devicesCritical: number;
  topRunbooks: Array<{ key: string; runs: number; succeeded: number; failed: number }>;
  escalations: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Gather a per-org stats snapshot covering the 24 h that just ended.
 * Returns null if the org had zero relevant activity (we still write a
 * "quiet day" brief — but the caller may choose to skip).
 */
export async function gatherStats(organizationId: string, now: Date): Promise<BriefStats> {
  const since = new Date(now.getTime() - ONE_DAY_MS);

  return runWithTenant(organizationId, async () => {
    const [opened, resolved, autoResolved, breaches, criticalDevices, runbookGroups, escalations] = await Promise.all([
      prisma.ticket.count({ where: { createdAt: { gte: since } } }),
      prisma.ticket.count({ where: { resolvedAt: { gte: since } } }),
      prisma.runbookExecution.count({ where: { status: "SUCCEEDED", completedAt: { gte: since } } }),
      prisma.ticket.count({ where: { slaAlertedAt: { gte: since } } }),
      prisma.device.count({ where: { healthStatus: "CRITICAL" } }),
      prisma.runbookExecution.groupBy({
        by: ["runbookKey", "status"],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.runbookExecution.count({
        where: { status: "AWAITING_AGENT", startedAt: { gte: since } },
      }),
    ]);

    const byKey = new Map<string, { runs: number; succeeded: number; failed: number }>();
    for (const g of runbookGroups) {
      const cur = byKey.get(g.runbookKey) ?? { runs: 0, succeeded: 0, failed: 0 };
      cur.runs += g._count._all;
      if (g.status === "SUCCEEDED") cur.succeeded += g._count._all;
      if (g.status === "FAILED" || g.status === "CANCELLED") cur.failed += g._count._all;
      byKey.set(g.runbookKey, cur);
    }
    const topRunbooks = Array.from(byKey, ([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 5);

    return {
      ticketsOpened: opened,
      ticketsResolved: resolved,
      autoResolvedByBrain: autoResolved,
      slaBreached: breaches,
      devicesCritical: criticalDevices,
      topRunbooks,
      escalations,
    };
  });
}

function templateBrief(orgName: string, forDate: string, stats: BriefStats): string {
  const winRate = stats.ticketsResolved === 0
    ? "n/a"
    : `${Math.round((stats.autoResolvedByBrain / Math.max(1, stats.ticketsResolved)) * 100)}%`;
  const rb = stats.topRunbooks.length === 0
    ? "_no runbook activity in the last 24 h_"
    : stats.topRunbooks
        .map((r) => `- **${r.key}** — ${r.runs} run(s), ${r.succeeded} succeeded, ${r.failed} failed`)
        .join("\n");
  return [
    `# Relay daily brief — ${orgName}`,
    `_${forDate} (last 24 h)_`,
    "",
    `## Headline`,
    `- ${stats.ticketsOpened} tickets opened, ${stats.ticketsResolved} resolved`,
    `- Autopilot resolved **${stats.autoResolvedByBrain}** without human input (${winRate} win rate)`,
    `- ${stats.slaBreached} SLA breaches`,
    `- ${stats.devicesCritical} device(s) currently CRITICAL`,
    `- ${stats.escalations} runbook(s) parked for agent approval`,
    "",
    `## Top runbooks`,
    rb,
  ].join("\n");
}

const AI_SYSTEM_PROMPT = `You are Relay's morning-brief author for an IT helpdesk's autopilot. Read the JSON stats from the last 24 h and write a SHORT, scannable Markdown brief for the org's admins.

Constraints:
- 120–200 words MAXIMUM.
- One headline section (1-2 sentences).
- One "What worked" section (1-3 bullets).
- One "Watch this" section (1-3 bullets) — anything climbing/regressing.
- One "Suggested for today" line (a single concrete next step).
- No emojis. No marketing tone. Plain, useful English.
- Do NOT invent numbers — only use what's in the stats payload.`;

async function aiBriefMarkdown(orgName: string, forDate: string, stats: BriefStats): Promise<string | null> {
  if (!env.USE_AI_BRAIN || !env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: env.BRAIN_MODEL,
      max_tokens: 700,
      system: AI_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Org: ${orgName}\nFor date: ${forDate}\nStats JSON:\n${JSON.stringify(stats, null, 2)}`,
      }],
    });
    const block = resp.content.find((c) => c.type === "text");
    if (!block || block.type !== "text") return null;
    return block.text.trim();
  } catch (err) {
    console.error("[brief] AI generation failed, falling back to template:", err);
    return null;
  }
}

export async function generateBriefForOrg(args: {
  organizationId: string;
  orgName: string;
  now?: Date;
  forceRegenerate?: boolean;
}): Promise<{ stats: BriefStats; markdown: string; briefId: string } | null> {
  const now = args.now ?? new Date();
  const yesterday = new Date(now.getTime() - ONE_DAY_MS);
  const forDateUtc = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()));
  const forDate = ymd(forDateUtc);

  // Idempotent — one brief per (org, day). If we already wrote it today's
  // bucket, return that unless forceRegenerate is on.
  const existing = await basePrismaUnscoped.dailyBrief.findUnique({
    where: { organizationId_forDate: { organizationId: args.organizationId, forDate: forDateUtc } },
  });
  if (existing && !args.forceRegenerate) {
    return {
      stats: existing.stats as unknown as BriefStats,
      markdown: existing.markdown,
      briefId: existing.id,
    };
  }

  const stats = await gatherStats(args.organizationId, now);
  const ai = await aiBriefMarkdown(args.orgName, forDate, stats);
  const markdown = ai ?? templateBrief(args.orgName, forDate, stats);

  const row = await basePrismaUnscoped.dailyBrief.upsert({
    where: { organizationId_forDate: { organizationId: args.organizationId, forDate: forDateUtc } },
    create: {
      organizationId: args.organizationId,
      forDate: forDateUtc,
      markdown,
      stats: stats as unknown as object,
    },
    update: { markdown, stats: stats as unknown as object },
  });

  // Email admins + post to Slack — best-effort.
  await fanOut(args.organizationId, args.orgName, forDate, markdown, stats);

  return { stats, markdown, briefId: row.id };
}

async function fanOut(
  organizationId: string,
  orgName: string,
  forDate: string,
  markdown: string,
  stats: BriefStats,
): Promise<void> {
  const admins = await basePrismaUnscoped.user.findMany({
    where: { organizationId, role: "ADMIN" },
    select: { email: true, name: true },
  });

  if (admins.length > 0) {
    const text = markdown;
    const html = `<pre style="font-family: inherit; white-space: pre-wrap">${markdown.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c)}</pre>`;
    for (const a of admins) {
      try {
        await sendMail({
          to: a.email,
          subject: `Relay daily brief — ${orgName} — ${forDate}`,
          text, html,
        });
      } catch (err) {
        console.error("[brief] email failed:", err);
      }
    }
  }

  // Slack: short summary (the markdown body) + a one-liner stats teaser.
  const summary = `${stats.ticketsOpened} opened, ${stats.ticketsResolved} resolved, ` +
    `${stats.autoResolvedByBrain} auto, ${stats.slaBreached} SLA breach(es), ` +
    `${stats.devicesCritical} CRITICAL device(s).`;
  try {
    await notifySlackBrief({ organizationId, orgName, forDate, summary });
  } catch (err) {
    console.error("[brief] slack notify failed:", err);
  }
}

/** Generate briefs for every non-platform organization. */
export async function runDailyBriefsForAllOrgs(now: Date = new Date()): Promise<{ generated: number }> {
  const orgs = await basePrismaUnscoped.organization.findMany({
    where: { suspendedAt: null, slug: { not: "relay" } },
    select: { id: true, name: true },
  });
  let generated = 0;
  for (const o of orgs) {
    try {
      const r = await generateBriefForOrg({ organizationId: o.id, orgName: o.name, now });
      if (r) generated += 1;
    } catch (err) {
      console.error(`[brief] org ${o.id} failed:`, err);
    }
  }
  return { generated };
}

// ─── Cron wrapper ─────────────────────────────────────────────────

let task: cron.ScheduledTask | null = null;

export function startDailyBriefCron(): void {
  if (task) return;
  const expression = env.DAILY_BRIEF_CRON;
  if (!cron.validate(expression)) {
    console.warn(`[brief] invalid DAILY_BRIEF_CRON (${expression}); skipping.`);
    return;
  }
  console.log(`[brief] daily brief cron scheduled  (${expression})`);
  task = cron.schedule(expression, () => {
    runDailyBriefsForAllOrgs().then(
      (r) => console.log(`[brief] generated ${r.generated} brief(s)`),
      (err) => console.error("[brief] cron run failed:", err),
    );
  });
}

export function stopDailyBriefCron(): void {
  if (task) { task.stop(); task = null; }
}
