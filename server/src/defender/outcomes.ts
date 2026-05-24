/**
 * Phase 26 — Outcome measurement for the learning loop.
 *
 * Every time the daily cron fires, we first walk yesterday's DefenderRun
 * and score it:
 *   • For every `open_ticket` decision, did the resulting ticket get
 *     RESOLVED? (positive signal)
 *   • For every `dismiss_match` decision, has a NEW intel item arrived
 *     mentioning the same CVE on the same fleet? (false-negative signal)
 *   • For every `ack_match`, no follow-up needed.
 *
 * Stored on `DefenderRun.outcomes` so the next day's situation report
 * can quote the numbers back to the agent.
 */

import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import type { DefenderDecision } from "./types.js";

export interface OutcomeReport {
  defenderRunId: string;
  decisionsMade: number;
  ticketsOpened: number;
  ticketsResolved: number;
  ticketsStillOpen: number;
  acksMade: number;
  dismissalsMade: number;
  dismissedThenRefired: number;
}

export async function measureOutcomesForOrg(organizationId: string): Promise<OutcomeReport | null> {
  // Find the most recent SUCCEEDED/HALTED run whose outcomes haven't been
  // measured yet AND that completed at least 12 h ago (give actions time
  // to play out).
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const prev = await basePrismaUnscoped.defenderRun.findFirst({
    where: {
      organizationId,
      status: { in: ["SUCCEEDED", "HALTED"] },
      outcomesMeasuredAt: null,
      completedAt: { lt: cutoff },
    },
    orderBy: { runDate: "desc" },
  });
  if (!prev) return null;

  const decisions = (prev.decisions as unknown as DefenderDecision[]) ?? [];
  const ticketIds = decisions
    .filter((d): d is Extract<DefenderDecision, { kind: "open_ticket" }> => d.kind === "open_ticket")
    .map((d) => d.ticketId);

  let ticketsResolved = 0;
  let ticketsStillOpen = 0;
  if (ticketIds.length > 0) {
    await runWithTenant(organizationId, async () => {
      const tickets = await prisma.ticket.findMany({
        where: { id: { in: ticketIds } }, select: { id: true, status: true },
      });
      for (const t of tickets) {
        if (t.status === "RESOLVED") ticketsResolved++;
        else ticketsStillOpen++;
      }
    });
  }

  // For dismissed matches — has any NEW ThreatMatch landed for the same
  // ThreatIntelId in the same org since? If yes, the dismissal was wrong.
  let dismissedThenRefired = 0;
  const dismissedIntelIds = await runWithTenant(organizationId, async () => {
    const dismissed = decisions
      .filter((d): d is Extract<DefenderDecision, { kind: "dismiss_match" }> => d.kind === "dismiss_match")
      .map((d) => d.matchId);
    if (dismissed.length === 0) return [];
    const rows = await prisma.threatMatch.findMany({
      where: { id: { in: dismissed } },
      select: { threatIntelId: true },
    });
    return rows.map((r) => r.threatIntelId);
  });
  if (dismissedIntelIds.length > 0) {
    const refired = await runWithTenant(organizationId, async () => {
      return prisma.threatMatch.count({
        where: {
          threatIntelId: { in: dismissedIntelIds },
          status: { in: ["OPEN", "CONVERTED_TO_TICKET", "ACKNOWLEDGED"] },
          createdAt: { gt: prev.completedAt ?? prev.startedAt },
        },
      });
    });
    dismissedThenRefired = refired;
  }

  const report: OutcomeReport = {
    defenderRunId: prev.id,
    decisionsMade: decisions.length,
    ticketsOpened: ticketIds.length,
    ticketsResolved,
    ticketsStillOpen,
    acksMade: decisions.filter((d) => d.kind === "ack_match").length,
    dismissalsMade: decisions.filter((d) => d.kind === "dismiss_match").length,
    dismissedThenRefired,
  };

  await basePrismaUnscoped.defenderRun.update({
    where: { id: prev.id },
    data: {
      outcomes: report as unknown as object,
      outcomesMeasuredAt: new Date(),
    },
  });
  return report;
}
