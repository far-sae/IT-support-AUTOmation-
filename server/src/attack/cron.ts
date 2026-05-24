/**
 * Weekly MITRE ATT&CK refresh — Sundays 04:00 UTC by default.
 * Cheap to run; idempotent upsert.
 */

import cron from "node-cron";
import { env } from "../env.js";
import { ingestMitreAttack } from "./mitre-ingest.js";

let task: ReturnType<typeof cron.schedule> | null = null;

export function startAttackRefreshCron(): void {
  if (task) return;
  task = cron.schedule(env.MITRE_ATTACK_REFRESH_CRON, () => {
    ingestMitreAttack()
      .then((r) => console.log(`[attack] refresh: upserted=${r.techniquesUpserted} revoked=${r.techniquesRevoked} in ${r.durationMs}ms`))
      .catch((err) => console.error("[attack] refresh failed:", err));
  });
  console.log(`[attack] refresh cron started (${env.MITRE_ATTACK_REFRESH_CRON})`);
}

export function stopAttackRefreshCron(): void { task?.stop(); task = null; }
