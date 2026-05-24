import { AgentActionKind } from "@prisma/client";
import type { Runbook } from "./types.js";
import { dispatchAgentAction, findTicketDevice } from "./agentActions.js";
import { prisma } from "../db.js";

/**
 * restart_service — MEDIUM risk.
 *
 *   Match:   ticket mentions an app/service plus a fault keyword
 *            (crashing, frozen, broken, hanging). Pattern: a known app name
 *            sits next to a fault verb.
 *   Execute: dispatch RESTART_SERVICE for the detected service. Agent stops
 *            and restarts it locally; on success the verification engine
 *            closes the ticket.
 */

// Names the agent knows how to restart on each platform.
const KNOWN_SERVICES = [
  "outlook", "teams", "slack", "zoom", "onedrive", "sharepoint", "vpn",
  "spooler", "print spooler", "bluetooth", "wifi", "docker", "vscode",
];

function detectService(text: string): string | null {
  const t = text.toLowerCase();
  for (const s of KNOWN_SERVICES) if (t.includes(s)) return s;
  return null;
}

export const restartServiceRunbook: Runbook = {
  key: "restart_service",
  name: "Restart misbehaving service",
  description: "When a named app/service is crashing, stuck or frozen, ask the local agent to stop + restart it.",
  risk: "MEDIUM",

  match({ ticket }) {
    const t = ticket.description.toLowerCase();
    const faulted = /\b(crash|crashes|crashing|freez|frozen|hang|hung|stuck|broken|not\s+working|wont\s+open|won.?t\s+open|won.?t\s+start)\b/.test(t);
    if (!faulted) return { confidence: 0, reason: "no fault verb" };
    const service = detectService(t);
    if (!service) return { confidence: 0, reason: "no known service mentioned" };
    return { confidence: 0.85, reason: `fault on "${service}"` };
  },

  async execute(ctx) {
    const service = detectService(ctx.ticket.description.toLowerCase());
    if (!service) {
      return { status: "FAILED", publicComment: "", decision: { error: "service vanished" } };
    }
    const device = await findTicketDevice({
      organizationId: ctx.ticket.organizationId,
      submitterName: ctx.ticket.submitterName,
    });
    if (!device) {
      return {
        status: "FAILED", publicComment: "",
        internalNote: "[restart_service] no agent-managed device",
        decision: { error: "no device", service },
      };
    }

    const exec = await prisma.runbookExecution.findFirst({
      where: { ticketId: ctx.ticket.id, runbookKey: "restart_service" },
      orderBy: { startedAt: "desc" },
    });

    const dispatched = await dispatchAgentAction({
      organizationId: ctx.ticket.organizationId,
      deviceId: device.id,
      deviceHostname: device.hostname,
      kind: AgentActionKind.RESTART_SERVICE,
      input: { service, ticketId: ctx.ticket.id },
      runbookExecutionId: exec?.id,
    });

    return {
      status: "AWAITING_VERIFICATION",
      publicComment:
        `Hi ${ctx.ticket.submitterName.split(" ")[0] ?? "there"} — I'm restarting **${service}** on ${dispatched.deviceHostname}. ` +
        `Give it a minute and try again. If it still misbehaves, just reply here and I'll switch tactics.\n\n— Relay autopilot`,
      internalNote: `Dispatched RESTART_SERVICE(${service}) → ${dispatched.deviceHostname} (action ${dispatched.actionId}).`,
      decision: { action: "restart_service", service, deviceHostname: dispatched.deviceHostname, actionId: dispatched.actionId },
    };
  },
};
