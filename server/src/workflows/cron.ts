/**
 * Workflow advancer cron.
 *
 * Ticks every WORKFLOW_TICK_SECONDS (default 30). Each tick walks every
 * RUNNING / WAITING execution and tries to advance one step on each. Picks
 * up where it left off after a crash, since state lives in Postgres.
 */

import cron from "node-cron";
import { env } from "../env.js";
import { advanceWorkflows } from "./engine.js";

let task: ReturnType<typeof cron.schedule> | null = null;

export function startWorkflowCron(): void {
  if (task) return;
  // node-cron supports seconds with 6-field expressions when we pass
  // { scheduled: true }; we use a minute-level granularity below to match
  // node-cron's default behaviour. Effective minimum tick = 1 minute, fine
  // for in-flight workflows whose finest-grained WAIT is 30 s (the
  // executor will catch up next tick).
  const expr = `*/${env.WORKFLOW_TICK_MINUTES} * * * *`;
  task = cron.schedule(expr, () => {
    advanceWorkflows(new Date())
      .then((n) => { if (n > 0) console.log(`[workflow] tick: advanced ${n}`); })
      .catch((err) => console.error("[workflow] tick failed:", err));
  });
  console.log(`[workflow] cron started (${expr})`);
}

export function stopWorkflowCron(): void {
  task?.stop();
  task = null;
}
