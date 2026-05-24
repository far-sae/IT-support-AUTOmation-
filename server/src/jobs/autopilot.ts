/**
 * Autopilot cron loop — Phase 10B.
 *
 * Ticks every AUTOPILOT_INTERVAL_MINUTES (default 1). Two responsibilities:
 *
 *   1. Settle any AWAITING_VERIFICATION executions whose `verifyAt` timer
 *      has expired without a negative signal — they get marked SUCCEEDED
 *      and their tickets close (+ survey fires).
 *
 *   2. Pick up any OPEN tickets that have NO runbook execution yet — the
 *      inline brain call must have failed or been skipped. Re-trigger the
 *      brain on them so nothing slips through the cracks.
 *
 * Runs cross-org via the unscoped client; per-ticket work re-enters the
 * appropriate tenant context so all downstream Prisma queries are scoped.
 */

import cron from "node-cron";
import { TicketStatus } from "@prisma/client";

import { basePrismaUnscoped } from "../db.js";
import { env } from "../env.js";
import { runWithTenant } from "../tenant/context.js";
import { settleVerifications, decideAndExecute } from "../brain/index.js";
import { triage } from "../triage.js";

let task: cron.ScheduledTask | null = null;

export async function autopilotTick(now: Date = new Date()): Promise<{ settled: number; rescued: number }> {
  let settled = 0;
  let rescued = 0;

  // ── 1. Settle verifications. ──────────────────────────────────────
  // settleVerifications inspects the rows and operates per-row inside the
  // tenant context of each ticket, so we can call it unscoped here.
  // (The function itself uses `prisma` which the extension would normally
  // filter, but we're outside any context — so it queries cross-org.)
  // For accurate emit-to-org behaviour we run per-org.
  const dueExecutions = await basePrismaUnscoped.runbookExecution.findMany({
    where: { status: "AWAITING_VERIFICATION", verifyAt: { lte: now } },
    select: { organizationId: true, id: true },
  });
  const orgsWithDue = new Set(dueExecutions.map((e) => e.organizationId));
  for (const orgId of orgsWithDue) {
    settled += await runWithTenant(orgId, () => settleVerifications({ now }));
  }

  // ── 2. Rescue any new tickets the inline brain missed. ────────────
  const orphans = await basePrismaUnscoped.ticket.findMany({
    where: {
      status: { not: TicketStatus.RESOLVED },
      runbookExecutions: { none: {} },
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, // last 24 h
    },
    take: 20,
  });
  for (const ticket of orphans) {
    try {
      await runWithTenant(ticket.organizationId, async () => {
        const tri = triage(ticket.description);
        await decideAndExecute(ticket, tri);
      });
      rescued += 1;
    } catch (err) {
      console.error("[autopilot] rescue failed for ticket", ticket.refCode, err);
    }
  }

  if (settled > 0 || rescued > 0) {
    console.log(`[autopilot] tick ${now.toISOString()}: settled=${settled} rescued=${rescued}`);
  }
  return { settled, rescued };
}

export function startAutopilotCron(): void {
  if (task) return;
  const minutes = env.AUTOPILOT_INTERVAL_MINUTES;
  const expression = `*/${minutes} * * * *`;
  console.log(`[autopilot] cron scheduled every ${minutes}m  (${expression})`);
  task = cron.schedule(expression, () => {
    autopilotTick().catch((err) => console.error("[autopilot] tick failed:", err));
  });
}

export function stopAutopilotCron(): void {
  if (task) { task.stop(); task = null; }
}
