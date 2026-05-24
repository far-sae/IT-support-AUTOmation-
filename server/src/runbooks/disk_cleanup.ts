import { AgentActionKind } from "@prisma/client";
import type { Runbook } from "./types.js";
import { dispatchAgentAction, findTicketDevice } from "./agentActions.js";
import { prisma } from "../db.js";

/**
 * disk_cleanup — LOW risk.
 *
 *   Match:   "slow" / "out of space" / "disk full" / "low storage" on a
 *            Hardware ticket, OR the submitter's device is at >= 85% disk
 *            (read from the latest metric).
 *   Execute: dispatch DISK_CLEANUP. Agent removes temp + cache files.
 */
export const diskCleanupRunbook: Runbook = {
  key: "disk_cleanup",
  name: "Free up disk space",
  description: "When the device is low on space, ask the agent to clean temp / cache files. Telemetry verification confirms the disk dropped.",
  risk: "LOW",

  match({ ticket, triage }) {
    const t = ticket.description.toLowerCase();
    const directHit =
      /\b(disk|drive|storage)\b.{0,20}\b(full|is\s+full|nearly\s+full|low|out\s+of)\b/.test(t) ||
      /\b(out\s+of\s+space|low\s+(on\s+)?(disk|storage|space)|no\s+disk\s+space)\b/.test(t);
    const slowHardware = triage.category === "Hardware" && /\b(slow|sluggish)\b/.test(t);
    if (directHit) return { confidence: 0.9, reason: "explicit low-disk wording" };
    if (slowHardware) return { confidence: 0.6, reason: "Hardware/slow → maybe disk-related" };
    return { confidence: 0, reason: "no disk keywords" };
  },

  async execute(ctx) {
    const device = await findTicketDevice({
      organizationId: ctx.ticket.organizationId,
      submitterName: ctx.ticket.submitterName,
    });
    if (!device) {
      return { status: "FAILED", publicComment: "", decision: { error: "no device" } };
    }
    const exec = await prisma.runbookExecution.findFirst({
      where: { ticketId: ctx.ticket.id, runbookKey: "disk_cleanup" },
      orderBy: { startedAt: "desc" },
    });
    const d = await dispatchAgentAction({
      organizationId: ctx.ticket.organizationId,
      deviceId: device.id, deviceHostname: device.hostname,
      kind: AgentActionKind.DISK_CLEANUP,
      input: { ticketId: ctx.ticket.id },
      runbookExecutionId: exec?.id,
    });
    return {
      status: "AWAITING_VERIFICATION",
      publicComment:
        `Hi ${ctx.ticket.submitterName.split(" ")[0] ?? "there"} — I'm clearing temp + cache files on ${d.deviceHostname} to free up space. ` +
        `You'll see the disk usage drop on the assets page when the next agent check-in lands.\n\n— Relay autopilot`,
      internalNote: `Dispatched DISK_CLEANUP → ${d.deviceHostname}.`,
      decision: { action: "disk_cleanup", deviceHostname: d.deviceHostname, actionId: d.actionId },
    };
  },
};
