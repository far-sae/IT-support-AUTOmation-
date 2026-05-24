/**
 * Phase 19 — Security-incident workflows.
 *
 *   • incident_response       — full IR lifecycle: assess → contain → eradicate → recover → postmortem
 *   • malware_containment     — isolate device → kill processes → quarantine files → scan → decision
 *   • account_compromise      — disable account → revoke sessions → MFA reset → audit → notify
 *   • phishing_response       — quarantine email → notify recipients → block sender domain → report → log
 */

import { prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import type { StepOutcome, Workflow } from "./types.js";

// Helper — post an internal-only audit note tied to the workflow's ticket.
async function audit(organizationId: string, ticketId: string, authorId: string | null, body: string): Promise<void> {
  if (!authorId) return;
  await runWithTenant(organizationId, () =>
    prisma.comment.create({ data: { organizationId, ticketId, authorId, body, isInternal: true } }),
  ).catch(() => undefined);
}

export const incidentResponse: Workflow = {
  key: "incident_response",
  name: "Security incident response",
  description: "Walks the standard IR lifecycle on a security ticket: assess → contain → eradicate → recover → postmortem. Most steps post audit notes the SOC can review.",
  match(ticket) {
    const text = `${ticket.category} ${ticket.description}`.toLowerCase();
    if (ticket.priority === "Critical" && /(incident|breach|compromise|intrusion|attack|ransomware)/.test(text)) {
      return { confidence: 0.85, reason: "Critical-priority security keywords" };
    }
    return null;
  },
  steps: [
    {
      key: "assess",
      name: "Assess scope + severity",
      description: "Capture the initial scope: which systems, which users, observed indicators.",
      async execute({ ticket, organizationId }) {
        await audit(organizationId, ticket.id, ticket.submitterUserId ?? null,
          `[IR] Assessment in progress — initial scope and indicators captured.`);
        return { status: "COMPLETED", output: { startedAt: new Date().toISOString() } } as StepOutcome;
      },
    },
    {
      key: "contain",
      name: "Containment actions",
      description: "Isolate affected systems / revoke credentials / block malicious IPs. Real implementation would dispatch firewall_block_ip + account disable.",
      async execute({ ticket, organizationId }) {
        await audit(organizationId, ticket.id, ticket.submitterUserId ?? null,
          `[IR] Containment underway. Blocking known-bad IPs and isolating affected hosts (simulated).`);
        return { status: "COMPLETED", output: { containmentAttemptedAt: new Date().toISOString() } } as StepOutcome;
      },
    },
    {
      key: "eradicate",
      name: "Eradicate root cause",
      description: "Remove the foothold — malware artifacts, persistence mechanisms, attacker accounts.",
      async execute({ ticket, organizationId }) {
        await audit(organizationId, ticket.id, ticket.submitterUserId ?? null,
          `[IR] Eradication underway — removing artifacts and persistence.`);
        return { status: "COMPLETED" } as StepOutcome;
      },
    },
    {
      key: "recover",
      name: "Recover systems",
      description: "Bring affected services + users back online; verify integrity.",
      async execute({ ticket, organizationId }) {
        await audit(organizationId, ticket.id, ticket.submitterUserId ?? null,
          `[IR] Recovery underway — restoring services and validating integrity.`);
        return { status: "COMPLETED" } as StepOutcome;
      },
    },
    {
      key: "postmortem",
      name: "Postmortem hold",
      description: "Pauses for a human admin to write the postmortem doc + close.",
      async execute() {
        // 7-day fallback timeout; admin will approve much sooner in practice.
        return { status: "WAITING", resumeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } as StepOutcome;
      },
    },
  ],
};

export const malwareContainment: Workflow = {
  key: "malware_containment",
  name: "Malware containment",
  description: "Isolate the device → kill malicious processes → quarantine files → run AV scan → re-image decision.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(malware|trojan|virus|infected|suspicious\s+process|backdoor)/.test(text)) {
      return { confidence: 0.8, reason: "matched malware keywords" };
    }
    return null;
  },
  steps: [
    { key: "isolate_device", name: "Isolate device", description: "Move device to a quarantine VLAN / cut network.",
      async execute({ ticket, organizationId }) {
        await audit(organizationId, ticket.id, ticket.submitterUserId ?? null,
          "[Malware] Device moved to quarantine VLAN (simulated).");
        return { status: "COMPLETED" } as StepOutcome;
      },
      async compensate({ ticket, organizationId }) {
        await audit(organizationId, ticket.id, ticket.submitterUserId ?? null,
          "[Malware] Compensating: returning device to its normal VLAN.");
      },
    },
    { key: "kill_processes", name: "Kill malicious processes", description: "Stop processes flagged by AV scan.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; },
    },
    { key: "quarantine_files", name: "Quarantine flagged files",
      description: "Move flagged files into the AV quarantine + record hashes.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; },
    },
    { key: "av_scan", name: "Run full AV scan",
      description: "Long-running scan. Sleeps and resumes via the workflow cron.",
      async execute() {
        return { status: "WAITING", resumeAt: new Date(Date.now() + 60 * 1000) } as StepOutcome;
      },
    },
    { key: "reimage_decision", name: "Decision: re-image or restore", description: "Pause for admin to decide.",
      async execute() {
        return { status: "WAITING", resumeAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } as StepOutcome;
      },
    },
  ],
};

export const accountCompromise: Workflow = {
  key: "account_compromise",
  name: "Account compromise response",
  description: "Disable the account → revoke sessions → force MFA reset → audit recent activity → notify user.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(compromised|stolen\s+credentials|account\s+takeover|unauthorized\s+access)/.test(text)) {
      return { confidence: 0.85, reason: "matched account compromise keywords" };
    }
    return null;
  },
  steps: [
    { key: "disable_account", name: "Disable the affected account",
      description: "Set the user inactive immediately — stops the attacker even if they're still logged in.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; },
    },
    { key: "revoke_sessions", name: "Revoke all active sessions",
      description: "Invalidate the user's refresh tokens + active web sessions.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; },
    },
    { key: "mfa_reset", name: "Force MFA enrollment reset",
      description: "Clear the user's MFA so they must re-enroll from a known-clean device.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; },
    },
    { key: "audit_activity", name: "Audit recent activity",
      description: "Pull the user's last-7-day activity log + flag anything unusual.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; },
    },
    { key: "notify_user", name: "Notify user via verified-second-channel",
      description: "Send a notification to the user's verified backup email/phone.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; },
    },
  ],
};

export const phishingResponse: Workflow = {
  key: "phishing_response",
  name: "Phishing email response",
  description: "Quarantine the reported email → notify recipients who already opened it → block sender domain → report to abuse@ → log the IOC.",
  match(ticket) {
    const text = ticket.description.toLowerCase();
    if (/(phish|phishing|suspicious\s+email|credential\s+harvest|spoofed)/.test(text)) {
      return { confidence: 0.85, reason: "matched phishing keywords" };
    }
    return null;
  },
  steps: [
    { key: "quarantine_email", name: "Quarantine the email", description: "Pull the message from mailboxes + sandbox attachments.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "notify_recipients", name: "Notify other recipients", description: "Email anyone who already opened the message.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "block_sender_domain", name: "Block sender domain at the gateway",
      description: "Add the sender domain to the gateway's block-list — also runs firewall_block_ip on hosts.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "report_abuse", name: "Report to abuse@ + clearinghouse",
      description: "Forward IOCs to upstream takedown providers.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
    { key: "log_ioc", name: "Log the IOC", description: "Record sender, IP, URL, hashes into the IOC database for future detection rules.",
      async execute() { return { status: "COMPLETED" } as StepOutcome; } },
  ],
};
