/**
 * Detection cron — ticks every DETECTION_INTERVAL_MINUTES.
 *
 * Each tick walks every non-platform organization and evaluates the
 * built-in rules. Hits are deduped per (org, rule, window) so the same
 * burst doesn't produce N rows.
 */

import cron from "node-cron";
import { env } from "../env.js";
import { runDetectionsForAllOrgs } from "./engine.js";

let task: ReturnType<typeof cron.schedule> | null = null;

export function startDetectionCron(): void {
  if (task) return;
  const expr = `*/${env.DETECTION_INTERVAL_MINUTES} * * * *`;
  task = cron.schedule(expr, () => {
    runDetectionsForAllOrgs(new Date())
      .then((r) => {
        if (r.hitsCreated > 0) {
          console.log(`[detect] tick: ${r.hitsCreated} new hit(s) across ${r.organizationsScanned} org(s)`);
        }
      })
      .catch((err) => console.error("[detect] tick failed:", err));
  });
  console.log(`[detect] cron started (${expr})`);
}

export function stopDetectionCron(): void {
  task?.stop();
  task = null;
}
