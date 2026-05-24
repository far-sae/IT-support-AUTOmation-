import { AgentActionKind } from "@prisma/client";
import type { Runbook } from "./types.js";
import { dispatchAgentAction, findTicketDevice } from "./agentActions.js";
import { prisma } from "../db.js";

/**
 * run_diagnostic — LOW risk.
 *
 *   Match:   ambiguous Network / Hardware tickets (vpn, wifi, slow, dropping,
 *            won't connect) where it's worth running a probe before guessing
 *            a fix. Pretty broad on purpose.
 *   Execute: dispatch a RUN_DIAGNOSTIC AgentAction to the submitter's device.
 *            The agent runs ping/dns/route + service status and POSTs the
 *            structured report back. Result becomes a public comment + a
 *            green tick if everything looks fine.
 */
export const runDiagnosticRunbook: Runbook = {
  key: "run_diagnostic",
  name: "Run device diagnostic",
  description: "Ask the local agent to probe network, DNS, disk and key services. Posts the structured report on the ticket.",
  risk: "LOW",

  match({ ticket, triage }) {
    if (triage.category !== "Network" && triage.category !== "Hardware") {
      return { confidence: 0, reason: "wrong category" };
    }
    const t = ticket.description.toLowerCase();
    const hits = [
      /\b(slow|laggy|dropping|drops|disconnect|won.?t connect|cant connect|cannot connect)\b/,
      /\b(dns|ping|route|gateway|firewall|vpn|wifi|wi.?fi|ethernet)\b/,
      /\b(crash|crashes|freeze|frozen|hang|hung)\b/,
    ].filter((re) => re.test(t)).length;
    if (hits === 0) return { confidence: 0, reason: "no diagnostic keywords" };
    return { confidence: 0.6 + Math.min(0.25, hits * 0.1), reason: `${hits} diagnostic indicator(s)` };
  },

  async execute(ctx) {
    const device = await findTicketDevice({
      organizationId: ctx.ticket.organizationId,
      submitterName: ctx.ticket.submitterName,
    });
    if (!device) {
      return {
        status: "FAILED",
        publicComment: "",
        internalNote: "[run_diagnostic] no agent-managed device found for this user",
        decision: { error: "no device" },
      };
    }

    // Get the most recent runbook execution so we can link.
    const exec = await prisma.runbookExecution.findFirst({
      where: { ticketId: ctx.ticket.id, runbookKey: "run_diagnostic" },
      orderBy: { startedAt: "desc" },
    });

    const dispatched = await dispatchAgentAction({
      organizationId: ctx.ticket.organizationId,
      deviceId: device.id,
      deviceHostname: device.hostname,
      kind: AgentActionKind.RUN_DIAGNOSTIC,
      input: { ticketId: ctx.ticket.id },
      runbookExecutionId: exec?.id,
    });

    return {
      status: "AWAITING_VERIFICATION",
      publicComment:
        `Hi ${ctx.ticket.submitterName.split(" ")[0] ?? "there"} — I've kicked off a full diagnostic on **${dispatched.deviceHostname}**. ` +
        `The local agent is running network, DNS, disk and service checks now. I'll post the report here when it's done (typically within a minute).\n\n— Relay autopilot`,
      internalNote: `Dispatched RUN_DIAGNOSTIC to ${dispatched.deviceHostname} (action ${dispatched.actionId}).`,
      decision: {
        action: "run_diagnostic",
        deviceHostname: dispatched.deviceHostname,
        actionId: dispatched.actionId,
      },
    };
  },
};
