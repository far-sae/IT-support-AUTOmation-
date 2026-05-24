/**
 * Threat-intel poll cron — ticks every THREAT_INTEL_INTERVAL_MINUTES.
 */

import cron from "node-cron";
import { env } from "../env.js";
import { ingestAll } from "./engine.js";

let task: ReturnType<typeof cron.schedule> | null = null;

export function startThreatIntelCron(): void {
  if (task) return;
  const expr = `*/${env.THREAT_INTEL_INTERVAL_MINUTES} * * * *`;
  task = cron.schedule(expr, () => {
    ingestAll().catch((err) => console.error("[threat-intel] cron failed:", err));
  });
  console.log(`[threat-intel] cron started (${expr})`);
}

export function stopThreatIntelCron(): void {
  task?.stop();
  task = null;
}
