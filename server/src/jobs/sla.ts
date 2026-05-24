/**
 * SLA-breach scanner.
 *
 * Runs every SLA_CHECK_INTERVAL_MINUTES via node-cron. We need to look
 * across ALL organizations on each tick, so the scan itself runs without
 * a tenant context (the Prisma extension bypasses when none is set).
 * For each breached ticket we re-enter that ticket's tenant context so
 * the websocket emit goes to the correct `org:<id>` room only.
 */

import cron from "node-cron";
import { TicketStatus } from "@prisma/client";

import { basePrismaUnscoped } from "../db.js";
import { env } from "../env.js";
import { runWithTenant } from "../tenant/context.js";
import { emit } from "../realtime/socket.js";
import { sendMail } from "../email/mailer.js";
import { slaBreachEmail } from "../email/templates.js";
import { notifySlackBreach } from "../notifications/slack.js";

export interface BreachAlert {
  ticketId: string;
  organizationId: string;
  refCode: string;
  minutesOver: number;
  notifiedAgent: string | null;
}

export interface ScanResult {
  scannedAt: Date;
  alerted: BreachAlert[];
}

export async function scanAndAlertBreaches(now: Date = new Date()): Promise<ScanResult> {
  // Cross-org scan — use the unscoped client so we see every org.
  const breached = await basePrismaUnscoped.ticket.findMany({
    where: {
      status: { not: TicketStatus.RESOLVED },
      slaDueAt: { lte: now },
      slaAlertedAt: null,
    },
    include: {
      assignedAgent: { select: { email: true, name: true } },
    },
  });

  const alerted: BreachAlert[] = [];

  for (const ticket of breached) {
    const minutesOver = Math.max(0, Math.floor((now.getTime() - ticket.slaDueAt.getTime()) / 60_000));

    await basePrismaUnscoped.ticket.update({
      where: { id: ticket.id },
      data: { slaAlertedAt: now },
    });

    let notifiedAgent: string | null = null;
    if (ticket.assignedAgent?.email) {
      try {
        const built = slaBreachEmail({
          refCode: ticket.refCode,
          priority: ticket.priority,
          assignedTeam: ticket.assignedTeam,
          category: ticket.category,
          description: ticket.description,
          minutesOver,
        });
        await sendMail({ to: ticket.assignedAgent.email, ...built });
        notifiedAgent = ticket.assignedAgent.email;
      } catch (err) {
        console.error("[sla] failed to send breach email:", err);
      }
    } else {
      console.log(`[sla] ${ticket.refCode} breached but has no assigned agent (team: ${ticket.assignedTeam})`);
    }

    // Emit inside the ticket's tenant so it only reaches that org's clients.
    runWithTenant(ticket.organizationId, () => {
      emit("sla:breach", { ticketId: ticket.id, refCode: ticket.refCode, minutesOver });
      emit("analytics:updated", { reason: "sla-breach" });
    });

    // Phase 11 — Slack notification (best-effort).
    void notifySlackBreach({
      organizationId: ticket.organizationId,
      refCode: ticket.refCode,
      priority: ticket.priority,
      team: ticket.assignedTeam,
      minutesOver,
    });

    // Phase 12 — event bus mirror (drives Kafka / ES if configured).
    try {
      const { bus } = await import("../events/bus.js");
      bus.emit({
        kind: "sla.breached",
        organizationId: ticket.organizationId,
        ticketId: ticket.id,
        refCode: ticket.refCode,
        priority: ticket.priority,
        minutesOver,
      });
    } catch { /* best-effort */ }

    alerted.push({
      ticketId: ticket.id,
      organizationId: ticket.organizationId,
      refCode: ticket.refCode,
      minutesOver,
      notifiedAgent,
    });
  }

  return { scannedAt: now, alerted };
}

// ─── Cron wrapper ────────────────────────────────────────────────────

let task: cron.ScheduledTask | null = null;

export function startSlaCron(): void {
  if (task) return;
  const minutes = env.SLA_CHECK_INTERVAL_MINUTES;
  const expression = `*/${minutes} * * * *`;
  console.log(`[sla] cron scheduled every ${minutes}m  (${expression})`);

  task = cron.schedule(expression, () => {
    scanAndAlertBreaches().catch((err) => console.error("[sla] scan failed:", err));
  });
}

export function stopSlaCron(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
