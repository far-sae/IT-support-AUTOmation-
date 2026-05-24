import { AgentActionKind } from "@prisma/client";
import type { Runbook } from "./types.js";
import { dispatchAgentAction, findTicketDevice } from "./agentActions.js";
import { prisma } from "../db.js";

/**
 * apply_pending_updates — MEDIUM risk.
 *
 *   Match:   ticket mentions "update(s)" / "patch" / "security" — or the
 *            device's patchStatus reports pending updates.
 *   Execute: dispatch APPLY_PENDING_UPDATES. Agent installs available
 *            OS-level updates.
 */
export const applyUpdatesRunbook: Runbook = {
  key: "apply_pending_updates",
  name: "Apply pending updates",
  description: "Ask the local agent to install any pending OS / security updates on the user's device.",
  risk: "MEDIUM",

  match({ ticket }) {
    const t = ticket.description.toLowerCase();
    const mentioned = /\b(updat(e|es|ing)|patch(es)?|security\s+fix|reboot\s+required)\b/.test(t);
    if (!mentioned) return { confidence: 0, reason: "no update keywords" };
    return { confidence: 0.78, reason: "update-related ticket" };
  },

  async execute(ctx) {
    const device = await findTicketDevice({
      organizationId: ctx.ticket.organizationId,
      submitterName: ctx.ticket.submitterName,
    });
    if (!device) return { status: "FAILED", publicComment: "", decision: { error: "no device" } };
    const exec = await prisma.runbookExecution.findFirst({
      where: { ticketId: ctx.ticket.id, runbookKey: "apply_pending_updates" },
      orderBy: { startedAt: "desc" },
    });
    const d = await dispatchAgentAction({
      organizationId: ctx.ticket.organizationId,
      deviceId: device.id, deviceHostname: device.hostname,
      kind: AgentActionKind.APPLY_PENDING_UPDATES,
      input: { ticketId: ctx.ticket.id },
      runbookExecutionId: exec?.id,
    });
    return {
      status: "AWAITING_VERIFICATION",
      publicComment:
        `Hi ${ctx.ticket.submitterName.split(" ")[0] ?? "there"} — I'm applying pending updates on ${d.deviceHostname}. ` +
        `You may be prompted to reboot once they're staged.\n\n— Relay autopilot`,
      internalNote: `Dispatched APPLY_PENDING_UPDATES → ${d.deviceHostname}.`,
      decision: { action: "apply_pending_updates", deviceHostname: d.deviceHostname, actionId: d.actionId },
    };
  },
};
