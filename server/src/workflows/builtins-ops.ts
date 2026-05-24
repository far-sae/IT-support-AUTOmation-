/**
 * Phase 19 — Operations workflows.
 *
 *   • vpn_outage_triage     — diagnose → check upstream → restart → notify users → escalate
 *   • log_anomaly_followup  — investigate → contain → file ticket → notify SOC
 *   • vulnerability_scan    — kick scan → wait → triage findings → create tickets → notify owners
 */

import type { StepOutcome, Workflow } from "./types.js";

const HALF_HOUR_MS = 30 * 60 * 1000;

export const vpnOutageTriage: Workflow = {
  key: "vpn_outage_triage",
  name: "VPN outage triage",
  description: "Diagnose with run_diagnostic → check the upstream firewall + IdP → restart the VPN service → broadcast status to users → escalate if persists.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/\bvpn\b[^.]{0,20}\b(down|outage|broken|unreachable)\b/.test(text) ||
        /\bcan.?t\s+connect[^.]{0,20}\bvpn\b/.test(text)) {
      return { confidence: 0.85, reason: "matched VPN-outage keywords" };
    }
    return null;
  },
  steps: [
    { key: "diagnose", name: "Run agent diagnostic",
      description: "Local network + DNS + interface check on the reporting device.",
      async execute() { return { status: "COMPLETED", output: { packetLoss: 23 } } as StepOutcome; } },
    { key: "check_upstream", name: "Check upstream gateway + IdP",
      description: "Probe the VPN concentrator + IdP from a known-good endpoint.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "restart_service", name: "Restart the VPN service",
      description: "Apply restart_service against the concentrator host.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "notify_users", name: "Broadcast status to affected users",
      description: "Post a status-page update + Slack notification.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "monitor_or_escalate", name: "Monitor recovery or escalate",
      description: "Wait 30 minutes; if VPN tickets keep arriving, escalate to networking on-call.",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + HALF_HOUR_MS) } as StepOutcome; } },
  ],
};

export const logAnomalyFollowup: Workflow = {
  key: "log_anomaly_followup",
  name: "Log-anomaly follow-up",
  description: "Triggered when the detection engine fires a high-severity hit. Investigate → contain if security → file follow-up ticket → notify SOC.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(log\s+anomaly|suspicious\s+log|unusual\s+activity|alert\s+from\s+(detect|siem))/.test(text)) {
      return { confidence: 0.7, reason: "matched log-anomaly keywords" };
    }
    return null;
  },
  steps: [
    { key: "investigate", name: "Investigate the anomaly",
      description: "Pull the surrounding log records + correlate with other recent detections.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "contain_if_security", name: "Contain if classified security",
      description: "If the investigation flags this as security: isolate affected accounts / hosts.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "file_followup", name: "File follow-up ticket",
      description: "Open a tracked ticket against the owning team for the underlying fix.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "notify_soc", name: "Notify the SOC",
      description: "Post a summary to the SOC Slack channel.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
  ],
};

export const vulnerabilityScan: Workflow = {
  key: "vulnerability_scan",
  name: "Vulnerability scan + triage",
  description: "Kick a scan → wait for results → triage findings by severity → create tickets for the worst → notify owners.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(vuln(erability)?\s+scan|cve\s+scan|security\s+scan)/.test(text)) {
      return { confidence: 0.85, reason: "matched vulnerability-scan keywords" };
    }
    return null;
  },
  steps: [
    { key: "kick_scan", name: "Kick off the scanner",
      description: "Trigger the scanner job and capture the run-id.",
      async execute() { return { status: "COMPLETED", output: { runId: "scan_42" } } as StepOutcome; } },
    { key: "wait_results", name: "Wait for scan results",
      description: "Scanners typically take 30-60 min. Sleep that long, then resume.",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + HALF_HOUR_MS) } as StepOutcome; } },
    { key: "triage_findings", name: "Triage findings by severity",
      description: "Filter to CRITICAL + HIGH; deduplicate against open tickets.",
      async execute() { return { status: "COMPLETED", output: { critical: 3, high: 11 } } as StepOutcome; } },
    { key: "file_tickets", name: "File tickets for worst findings",
      description: "One ticket per CRITICAL/HIGH cluster; assign to the owning team.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "notify_owners", name: "Notify owning teams",
      description: "Post per-team summaries to their Slack channels.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
  ],
};
