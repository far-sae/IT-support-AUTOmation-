/**
 * Phase 19 — Identity-lifecycle workflows.
 *
 *   • offboarding         — disable accounts → revoke device → wipe → archive → close
 *   • contractor_access   — create scoped acct → set expiry → grant → notify manager → schedule revoke
 *   • password_rotation   — list service accounts → rotate one → restart consumers → validate → next
 *   • license_audit       — list licenses → identify unused → notify owners → reclaim → report
 */

import type { StepOutcome, Workflow } from "./types.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const offboarding: Workflow = {
  key: "offboarding",
  name: "Employee offboarding",
  description: "Disable SSO + email accounts → revoke device + wipe → archive personal-drive data → close open tickets in their name.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(off-?board|leaving|last\s+day|termination|exit\s+(check|interview))/.test(text)) {
      return { confidence: 0.85, reason: "matched offboarding keywords" };
    }
    return null;
  },
  steps: [
    { key: "disable_accounts", name: "Disable SSO + email accounts",
      description: "Set Okta/Azure AD user to inactive; transfer mailbox to manager.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "revoke_device", name: "Revoke assigned device",
      description: "MDM lock + start remote wipe.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "archive_data", name: "Archive personal drive data",
      description: "Transfer drive contents to the manager's domain.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "close_open_tickets", name: "Close any tickets opened in their name",
      description: "Bulk-close tickets where they're submitter or assigned-agent.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "manager_signoff", name: "Pause for manager sign-off",
      description: "Manual confirmation that everything's been handled.",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + 7 * ONE_DAY_MS) } as StepOutcome; } },
  ],
};

export const contractorAccess: Workflow = {
  key: "contractor_access",
  name: "Contractor scoped access",
  description: "Create a scoped account with an expiry date → grant specific resources → notify the manager → schedule auto-revoke at expiry.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(contractor|consultant|temporary|temp\s+access|vendor\s+access)/.test(text)) {
      return { confidence: 0.8, reason: "matched contractor-access keywords" };
    }
    return null;
  },
  steps: [
    { key: "create_account", name: "Create scoped account",
      description: "Tag with role=CONTRACTOR + expiry metadata.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "set_expiry", name: "Set the auto-expiry date",
      description: "Write an expires-at timestamp so the daily janitor can revoke automatically.",
      async execute() { return { status: "COMPLETED", output: { expiresAt: new Date(Date.now() + 90 * ONE_DAY_MS).toISOString() } } as StepOutcome; } },
    { key: "grant_resources", name: "Grant the listed resources",
      description: "Add memberships only to the explicitly-named groups.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "notify_manager", name: "Notify the sponsoring manager",
      description: "Email the manager with the credentials + expiry.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "schedule_revoke", name: "Schedule the auto-revoke job",
      description: "Long WAIT — the cron resumes this step at the expiry date.",
      async execute() {
        // Default 90 days. Real impl would read from context.set_expiry.expiresAt.
        return { status: "WAITING", resumeAt: new Date(Date.now() + 90 * ONE_DAY_MS) } as StepOutcome;
      },
    },
  ],
};

export const passwordRotation: Workflow = {
  key: "password_rotation",
  name: "Service-account password rotation",
  description: "List service accounts due for rotation → rotate one → restart its consumers → validate they reconnect → next.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(rotate\s+(passwords|secrets|credentials)|password\s+rotation|secret\s+rotation)/.test(text)) {
      return { confidence: 0.85, reason: "matched password-rotation keywords" };
    }
    return null;
  },
  steps: [
    { key: "list_accounts", name: "List service accounts due for rotation",
      description: "Pull accounts where lastRotatedAt > 90 days ago.",
      async execute() { return { status: "COMPLETED", output: { dueCount: 4 } } as StepOutcome; } },
    { key: "rotate_one", name: "Rotate the first account",
      description: "Generate + commit the new credential to the vault.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "restart_consumers", name: "Rolling-restart the consumer services",
      description: "Trigger a rolling restart so each consumer picks up the new credential gracefully.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "validate_health", name: "Validate consumer health",
      description: "Read service-health metrics for 5 minutes — fail if any pod failed to reconnect.",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + 5 * 60 * 1000) } as StepOutcome; } },
    { key: "next_or_done", name: "Move to next account or finish",
      description: "If more accounts are due, loop. Otherwise close the ticket.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
  ],
};

export const licenseAudit: Workflow = {
  key: "license_audit",
  name: "License audit + reclaim",
  description: "List licenses → identify ones unused for > 30 days → notify owners → reclaim if no response in 5 days → report.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(license\s+(audit|reclaim|review)|unused\s+(licenses|seats)|seat\s+reclamation)/.test(text)) {
      return { confidence: 0.8, reason: "matched license-audit keywords" };
    }
    return null;
  },
  steps: [
    { key: "list_licenses", name: "List all assigned licenses",
      description: "Cross-reference vendor billing API with internal user directory.",
      async execute() { return { status: "COMPLETED", output: { total: 240 } } as StepOutcome; } },
    { key: "identify_unused", name: "Identify unused licenses",
      description: "Filter to assignments with no app login in the last 30 days.",
      async execute() { return { status: "COMPLETED", output: { unusedCount: 18 } } as StepOutcome; } },
    { key: "notify_owners", name: "Notify license owners",
      description: "Email each owner; they can claim or release.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "wait_5_days", name: "Wait 5 business days for responses",
      description: "Long WAIT — cron resumes after 5 days.",
      async execute() { return { status: "WAITING", resumeAt: new Date(Date.now() + 5 * ONE_DAY_MS) } as StepOutcome; } },
    { key: "reclaim_remaining", name: "Reclaim unresponded licenses",
      description: "Pull the license back into the pool.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "report", name: "Write audit report",
      description: "Internal note with reclaimed count + remaining users.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
  ],
};
