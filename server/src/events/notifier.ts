/**
 * Phase 12 — wire bus events into existing notification channels.
 *
 * Currently:
 *   • detection.hit  → Slack (per-org webhook) + Prometheus counter
 *
 * Kept separate from the bus + sinks so the notification policy can evolve
 * (PagerDuty, ServiceNow incident creation, etc.) without churning either.
 */

import { bus } from "./bus.js";
import { notifySlackDetection } from "../notifications/slack.js";
import { detectionHitsTotal } from "../observability/metrics.js";

let registered = false;

export function registerDetectionNotifier(): void {
  if (registered) return;
  registered = true;

  bus.on("detection.hit", async (ev) => {
    detectionHitsTotal.inc({ rule: ev.ruleKey, severity: ev.severity });
    await notifySlackDetection({
      organizationId: ev.organizationId,
      ruleKey: ev.ruleKey,
      severity: ev.severity,
      count: ev.count,
      evidence: ev.evidence,
    }).catch((err) => console.error("[notifier] slack detection failed:", err));
  });
}
