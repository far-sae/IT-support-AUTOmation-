/**
 * Phase 11 — Slack incoming-webhook notifications.
 *
 * `notifySlack(orgId, payload)` resolves the per-org webhook URL (with the
 * platform-level SLACK_WEBHOOK_URL env as a fallback) and POSTs a simple
 * Slack message-payload to it. Best-effort — failure logs but never throws.
 */

import { env } from "../env.js";
import { basePrismaUnscoped } from "../db.js";
import { parseOrgSettings } from "../tenant/settings.js";

export interface SlackPayload {
  /** Plain-text fallback / primary message body. */
  text: string;
  /** Optional Slack "Block Kit" blocks for richer rendering. */
  blocks?: unknown[];
  /** Optional channel override (rare — usually fixed at the webhook). */
  channel?: string;
}

export async function notifySlack(organizationId: string, payload: SlackPayload): Promise<{ delivered: boolean; reason?: string }> {
  const org = await basePrismaUnscoped.organization.findUnique({
    where: { id: organizationId }, select: { settings: true },
  });
  const url = parseOrgSettings(org?.settings).slackWebhookUrl || env.SLACK_WEBHOOK_URL;
  if (!url) {
    // Silent skip — Slack is opt-in per org.
    return { delivered: false, reason: "no webhook configured" };
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error(`[slack] webhook HTTP ${resp.status}: ${t.slice(0, 200)}`);
      return { delivered: false, reason: `HTTP ${resp.status}` };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[slack] fetch failed:", err);
    return { delivered: false, reason: (err as Error).message };
  }
}

/** Convenience: post a short SLA-breach alert. */
export async function notifySlackBreach(args: {
  organizationId: string;
  refCode: string;
  priority: string;
  team: string;
  minutesOver: number;
}): Promise<void> {
  await notifySlack(args.organizationId, {
    text: `:rotating_light: *SLA breach* — ${args.refCode} (${args.priority}) is ${args.minutesOver} min over its SLA. Team: ${args.team}.`,
  });
}

/** Convenience: post the morning brief link/summary. */
export async function notifySlackBrief(args: {
  organizationId: string;
  orgName: string;
  forDate: string;
  summary: string;
  url?: string;
}): Promise<void> {
  await notifySlack(args.organizationId, {
    text: `:sunrise: *Relay daily brief — ${args.orgName} — ${args.forDate}*\n${args.summary}${args.url ? `\n${args.url}` : ""}`,
  });
}

/** Phase 12 — post a detection hit. */
export async function notifySlackDetection(args: {
  organizationId: string;
  ruleKey: string;
  severity: string;
  count: number;
  evidence: Record<string, unknown>;
}): Promise<void> {
  const icon = args.severity === "CRITICAL" ? ":fire:"
    : args.severity === "HIGH" ? ":warning:"
    : args.severity === "MEDIUM" ? ":eyes:"
    : ":mag:";
  const evidenceText = Object.entries(args.evidence)
    .slice(0, 4)
    .map(([k, v]) => `• *${k}*: \`${JSON.stringify(v).slice(0, 120)}\``)
    .join("\n");
  await notifySlack(args.organizationId, {
    text: `${icon} *Detection — ${args.ruleKey}* (${args.severity}, count ${args.count})\n${evidenceText}`,
  });
}
