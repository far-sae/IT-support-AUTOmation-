import { AgentActionKind } from "@prisma/client";
import type { Runbook } from "./types.js";
import { dispatchAgentAction, findTicketDevice } from "./agentActions.js";
import { prisma } from "../db.js";

const KNOWN_APPS = ["outlook", "teams", "slack", "chrome", "firefox", "edge", "onedrive"];

/**
 * clear_cache — LOW risk.
 *   Match:   ticket mentions a known app + "sync" / "loading" / "stale".
 *   Execute: dispatch CLEAR_CACHE for that app.
 */
export const clearCacheRunbook: Runbook = {
  key: "clear_cache",
  name: "Clear app cache",
  description: "When an app is stuck loading or syncing stale data, ask the agent to nuke its local cache.",
  risk: "LOW",

  match({ ticket }) {
    const t = ticket.description.toLowerCase();
    const stale = /\b(sync(ing)?|loading|stale|stuck|won.?t\s+refresh|out of date|outdated|cached)\b/.test(t);
    if (!stale) return { confidence: 0, reason: "no staleness keyword" };
    const app = KNOWN_APPS.find((a) => t.includes(a));
    if (!app) return { confidence: 0, reason: "no known app" };
    return { confidence: 0.78, reason: `cache reset for "${app}"` };
  },

  async execute(ctx) {
    const t = ctx.ticket.description.toLowerCase();
    const app = KNOWN_APPS.find((a) => t.includes(a)) ?? "app";
    const device = await findTicketDevice({
      organizationId: ctx.ticket.organizationId,
      submitterName: ctx.ticket.submitterName,
    });
    if (!device) {
      return { status: "FAILED", publicComment: "", decision: { error: "no device", app } };
    }
    const exec = await prisma.runbookExecution.findFirst({
      where: { ticketId: ctx.ticket.id, runbookKey: "clear_cache" },
      orderBy: { startedAt: "desc" },
    });
    const d = await dispatchAgentAction({
      organizationId: ctx.ticket.organizationId,
      deviceId: device.id, deviceHostname: device.hostname,
      kind: AgentActionKind.CLEAR_CACHE,
      input: { app, ticketId: ctx.ticket.id },
      runbookExecutionId: exec?.id,
    });
    return {
      status: "AWAITING_VERIFICATION",
      publicComment:
        `Hi ${ctx.ticket.submitterName.split(" ")[0] ?? "there"} — I'm clearing **${app}**'s local cache on ${d.deviceHostname}. ` +
        `Once you re-open the app it'll re-download a fresh copy.\n\n— Relay autopilot`,
      internalNote: `Dispatched CLEAR_CACHE(${app}) → ${d.deviceHostname}.`,
      decision: { action: "clear_cache", app, deviceHostname: d.deviceHostname, actionId: d.actionId },
    };
  },
};
