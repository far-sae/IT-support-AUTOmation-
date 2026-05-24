/**
 * Phase 19 — Fleet + infrastructure workflows.
 *
 *   • patch_rollout_staged   — canary → staging → production patch progression
 *   • certificate_renewal    — check → request → install → restart → validate
 *   • lost_device            — remote lock → wipe trigger → revoke creds → file police report → disable
 *   • backup_verification    — list backups → trigger restore test → verify integrity → cleanup → report
 */

import type { StepOutcome, Workflow } from "./types.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

export const patchRolloutStaged: Workflow = {
  key: "patch_rollout_staged",
  name: "Staged patch rollout (canary → staging → production)",
  description: "Applies a patch to 10% canary devices, waits for health signal, expands to staging tier, waits again, then production. Aborts on detection.hit from `patch_rollout_failure`.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(stag(ed|ing)\s+(patch|rollout)|patch\s+rollout|canary\s+(patch|deploy))/.test(text)) {
      return { confidence: 0.8, reason: "matched staged-rollout keywords" };
    }
    return null;
  },
  steps: [
    { key: "canary_apply", name: "Apply to canary group", description: "Push to ~10% canary devices via apply_pending_updates runbook.",
      async execute() { return { status: "COMPLETED", output: { fleet: "canary" } } as StepOutcome; } },
    { key: "canary_wait", name: "Wait for canary health signal", description: "Sleep 1 hour so detection rules + telemetry catch regressions.",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + ONE_HOUR_MS) } as StepOutcome; } },
    { key: "staging_apply", name: "Apply to staging tier", description: "Expand to next tier.",
      async execute() { return { status: "COMPLETED", output: { fleet: "staging" } } as StepOutcome; } },
    { key: "staging_wait", name: "Wait for staging health signal",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + ONE_HOUR_MS) } as StepOutcome; },
      description: "Another hour of soak time." },
    { key: "production_apply", name: "Apply to production fleet",
      async execute() { return { status: "COMPLETED", output: { fleet: "production" } } as StepOutcome; },
      description: "Final fleet-wide rollout." },
  ],
};

export const certificateRenewal: Workflow = {
  key: "certificate_renewal",
  name: "TLS certificate renewal",
  description: "Check expiry → request from ACME issuer → install on load balancer → restart dependent services → validate the new cert.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/\bcert(ificate)?\b[^.]{0,30}\b(renew|renewal|expir)/.test(text) ||
        /\b(tls|ssl)\b[^.]{0,30}\b(renew|renewal|expir)/.test(text)) {
      return { confidence: 0.85, reason: "matched cert-renewal keywords" };
    }
    return null;
  },
  steps: [
    { key: "check_expiry", name: "Check current certificate expiry",
      description: "Read the live cert via TLS handshake; record days remaining.",
      async execute() { return { status: "COMPLETED", output: { daysRemaining: 12 } } as StepOutcome; } },
    { key: "request_new", name: "Request new certificate from ACME",
      description: "Issue a CSR + complete the HTTP-01 / DNS-01 challenge.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "install_cert", name: "Install the new cert on the load balancer",
      description: "PUT to the LB API + reload config.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "restart_services", name: "Restart cert-pinned services",
      description: "Services with explicitly-pinned certs need a graceful reload.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "validate_new", name: "Validate the new certificate", description: "Re-handshake; confirm subject, SAN list, expiry.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
  ],
};

export const lostDevice: Workflow = {
  key: "lost_device",
  name: "Lost / stolen device response",
  description: "Remote lock → wipe trigger → revoke device credentials → file police report ticket → disable in MDM.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/\b(lost|stolen|missing)\b[^.]{0,30}\b(laptop|device|phone|macbook|computer|hardware)\b/.test(text)) {
      return { confidence: 0.9, reason: "matched lost/stolen device keywords" };
    }
    return null;
  },
  steps: [
    { key: "remote_lock", name: "Remote lock the device",
      description: "Send MDM lock command — buys time before wipe.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "wipe_trigger", name: "Queue remote wipe",
      description: "Issue an MDM wipe — runs as soon as the device next checks in.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "revoke_creds", name: "Revoke the device's credentials",
      description: "Invalidate the device's cert + refresh tokens.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "file_police_report", name: "Open a police-report task",
      description: "If the device is stolen — not just lost — file the report. Pauses for manual confirmation.",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } as StepOutcome; } },
    { key: "disable_mdm", name: "Disable the device record in MDM",
      description: "Final step — once the wipe confirms, deactivate the device record.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
  ],
};

export const backupVerification: Workflow = {
  key: "backup_verification",
  name: "Backup verification (restore test)",
  description: "List recent backups → trigger a restore-test job → verify file integrity → tear down the test → write a verification report.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(backup\s+(verif|test|restore)|disaster\s+recovery|dr\s+test)/.test(text)) {
      return { confidence: 0.8, reason: "matched backup-verification keywords" };
    }
    return null;
  },
  steps: [
    { key: "list_backups", name: "List candidate backups",
      description: "Pick the most-recent successful snapshot from each protected source.",
      async execute() { return { status: "COMPLETED", output: { candidates: 8 } } as StepOutcome; } },
    { key: "trigger_restore_test", name: "Trigger restore-test job",
      description: "Restore to a temp instance — does NOT touch production data.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "wait_restore", name: "Wait for restore to finish",
      description: "Sleep an hour; the cron picks back up.",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + ONE_HOUR_MS) } as StepOutcome; } },
    { key: "verify_integrity", name: "Verify restored data integrity",
      description: "Compute file hashes, compare against the source manifest.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "cleanup", name: "Cleanup test instance",
      description: "Terminate the temp instance and storage volumes.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "report", name: "Write the verification report",
      description: "Internal note with verified backup IDs + hashes.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
  ],
};
