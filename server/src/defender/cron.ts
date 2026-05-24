/**
 * Defender daily cron.
 *
 * Each tick:
 *   1. Measure outcomes for every org's previous run.
 *   2. Run today's defender for each non-platform org.
 *
 * Step 1 first so step 2's situation report can include the freshly-
 * scored outcomes (the learning loop).
 */

import cron from "node-cron";
import { env } from "../env.js";
import { basePrismaUnscoped } from "../db.js";
import { runDefenderForOrg } from "./agent.js";
import { measureOutcomesForOrg } from "./outcomes.js";
import { runRuleStudyForOrg } from "../rules/study.js";

let task: ReturnType<typeof cron.schedule> | null = null;

export async function runDefenderForAllOrgs(now: Date = new Date()): Promise<void> {
  const orgs = await basePrismaUnscoped.organization.findMany({
    where: { slug: { not: "platform" }, suspendedAt: null },
    select: { id: true, slug: true },
  });
  for (const o of orgs) {
    try {
      const outcome = await measureOutcomesForOrg(o.id);
      if (outcome) {
        console.log(
          `[defender] ${o.slug} outcomes: ` +
          `${outcome.ticketsResolved}/${outcome.ticketsOpened} tickets resolved, ` +
          `${outcome.dismissedThenRefired}/${outcome.dismissalsMade} dismissals re-fired`,
        );
      }
      const r = await runDefenderForOrg(o.id, { runDate: now });
      console.log(`[defender] ${o.slug} run ${r.defenderRunId} ${r.status} iter=${r.iterations} decisions=${r.decisions.length}`);
      // Phase 27 — daily AI rule study. Best-effort; fail-soft.
      try {
        const s = await runRuleStudyForOrg(o.id);
        if (s.newDraftsCreated > 0) {
          console.log(`[rule-study] ${o.slug} drafted ${s.newDraftsCreated} new rules (considered ${s.techniquesConsidered} techniques)`);
        }
      } catch (err) {
        console.error(`[rule-study] ${o.slug} failed:`, err);
      }
    } catch (err) {
      console.error(`[defender] ${o.slug} failed:`, err);
    }
  }
}

export function startDefenderCron(): void {
  if (task) return;
  task = cron.schedule(env.DEFENDER_CRON, () => {
    runDefenderForAllOrgs().catch((err) => console.error("[defender] cron failed:", err));
  });
  console.log(`[defender] cron started (${env.DEFENDER_CRON})`);
}

export function stopDefenderCron(): void {
  task?.stop();
  task = null;
}
