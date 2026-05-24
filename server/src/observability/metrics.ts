/**
 * Phase 11 — Prometheus metrics endpoint.
 *
 * Default node-process metrics + custom counters / gauges for the autopilot.
 * `/metrics` returns the text exposition format Prometheus scrapes.
 */

import client, { Counter, Gauge, Histogram } from "prom-client";

client.collectDefaultMetrics({ prefix: "relay_" });

export const ticketsCreatedTotal = new Counter({
  name: "relay_tickets_created_total",
  help: "Tickets created, labelled by org slug, category and priority",
  labelNames: ["org", "category", "priority"] as const,
});

export const ticketsResolvedTotal = new Counter({
  name: "relay_tickets_resolved_total",
  help: "Tickets resolved, labelled by org slug",
  labelNames: ["org"] as const,
});

export const runbookRunsTotal = new Counter({
  name: "relay_runbook_runs_total",
  help: "Runbook executions, labelled by runbook key + final status",
  labelNames: ["org", "runbook", "status"] as const,
});

export const agentActionsTotal = new Counter({
  name: "relay_agent_actions_total",
  help: "Agent actions, labelled by kind + final status",
  labelNames: ["org", "kind", "status"] as const,
});

export const slaBreachesTotal = new Counter({
  name: "relay_sla_breaches_total",
  help: "SLA breaches, labelled by org",
  labelNames: ["org"] as const,
});

export const policyDeniesTotal = new Counter({
  name: "relay_policy_denies_total",
  help: "Policy denials, labelled by policy key + whether they escalated",
  labelNames: ["org", "policy", "escalated"] as const,
});

export const policyAllowsTotal = new Counter({
  name: "relay_policy_allows_total",
  help: "Policy ALLOW verdicts, labelled by org",
  labelNames: ["org"] as const,
});

export const brainIterations = new Histogram({
  name: "relay_brain_iterations",
  help: "Number of tool-use round-trips the AI brain performed per ticket",
  buckets: [1, 2, 3, 4, 5, 6, 8, 10],
  labelNames: ["org"] as const,
});

export const ticketResolutionSeconds = new Histogram({
  name: "relay_ticket_resolution_seconds",
  help: "Time from ticket creation to RESOLVED, by org",
  buckets: [10, 30, 60, 300, 900, 3600, 21_600, 86_400],
  labelNames: ["org"] as const,
});

export const openTicketsGauge = new Gauge({
  name: "relay_open_tickets",
  help: "Currently OPEN or IN_PROGRESS tickets, by org",
  labelNames: ["org"] as const,
});

export const autopilotSuccessRate = new Gauge({
  name: "relay_autopilot_success_rate",
  help: "Fraction (0..1) of recently-finalised runbook executions that SUCCEEDED, by org",
  labelNames: ["org"] as const,
});

// Phase 12 — detection hits, labelled by rule + severity.
export const detectionHitsTotal = new Counter({
  name: "relay_detection_hits_total",
  help: "Detection rule firings (NEW hits only — repeats inside the same window don't re-increment)",
  labelNames: ["rule", "severity"] as const,
});

export async function metricsExposition(): Promise<string> {
  return client.register.metrics();
}

export function metricsContentType(): string {
  return client.register.contentType;
}
