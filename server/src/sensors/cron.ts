/**
 * Wazuh poll cron — every WAZUH_POLL_MINUTES.
 */

import cron from "node-cron";
import { env } from "../env.js";
import { ingestWazuhAlerts } from "./ingest.js";

let task: ReturnType<typeof cron.schedule> | null = null;

export function startSensorCron(): void {
  if (task) return;
  // Skip start entirely when Wazuh isn't configured.
  if (!env.WAZUH_API_URL) {
    console.log("[sensors] Wazuh not configured, cron skipped");
    return;
  }
  const expr = `*/${env.WAZUH_POLL_MINUTES} * * * *`;
  task = cron.schedule(expr, () => {
    ingestWazuhAlerts()
      .then((r) => {
        if (r.newAlerts > 0) console.log(`[sensors] wazuh: ${r.newAlerts} new (fetched=${r.fetched})`);
        if (r.error) console.error(`[sensors] wazuh: ${r.error}`);
      })
      .catch((err) => console.error("[sensors] tick failed:", err));
  });
  console.log(`[sensors] cron started (${expr})`);
}

export function stopSensorCron(): void { task?.stop(); task = null; }
