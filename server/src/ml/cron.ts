/**
 * ML training cron — runs once a day at 03:00 UTC by default.
 *
 * Each tick trains the remediation classifier for every non-platform org.
 * Trains a fresh model + bumps version; the brain picks up the new active
 * row on its next prediction (cache TTL: 5 min).
 */

import cron from "node-cron";
import { env } from "../env.js";
import { trainAllOrgs } from "./trainer.js";
import { invalidateModelCache } from "./predict.js";

let task: ReturnType<typeof cron.schedule> | null = null;

export function startMlTrainerCron(): void {
  if (task) return;
  task = cron.schedule(env.ML_TRAIN_CRON, () => {
    trainAllOrgs()
      .then((rs) => {
        for (const r of rs) {
          invalidateModelCache(r.organizationId);
          console.log(`[ml] trained ${r.organizationId} v${r.version} acc=${(r.metrics.accuracy * 100).toFixed(1)}% n=${r.metrics.sampleCount}`);
        }
      })
      .catch((err) => console.error("[ml] cron failed:", err));
  });
  console.log(`[ml] training cron started (${env.ML_TRAIN_CRON})`);
}

export function stopMlTrainerCron(): void {
  task?.stop();
  task = null;
}
