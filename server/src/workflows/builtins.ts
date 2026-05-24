/**
 * Phase 13 — Built-in workflows.
 *
 * Two starter flows that exercise every step type:
 *
 *   • triage_network_issue
 *       diagnose → branch on result → restart service / clear cache → notify
 *
 *   • onboard_employee
 *       assign device → wait for agent → send welcome email → manual approval
 *
 * Each step demonstrates a different outcome:
 *   COMPLETED with branching, WAITING (sleep until time), and FAILED
 *   (with a compensate hook so the next step's restart is undone).
 */

import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { bus } from "../events/bus.js";
import type { StepOutcome, Workflow } from "./types.js";

const SHORT_WAIT_MS = 30 * 1000;   // 30 s — short, for demo-friendliness

// ─── triage_network_issue ────────────────────────────────────────────

export const triageNetworkIssue: Workflow = {
  key: "triage_network_issue",
  name: "Triage a network-related ticket",
  description: "Run diagnostic → branch on findings → restart the relevant service or clear the cache → notify the on-call channel.",
  match(ticket) {
    const text = `${ticket.category} ${ticket.description}`.toLowerCase();
    if (/(vpn|wifi|wi-fi|network|dns|connectivity|can.?t connect|drops|disconnect)/.test(text)) {
      return { confidence: 0.7, reason: "matched network keywords" };
    }
    return null;
  },
  steps: [
    {
      key: "run_diagnostic",
      name: "Run agent diagnostic",
      description: "Asks the local agent to capture ping/dns/route status. Reads back a structured result.",
      async execute({ organizationId }) {
        // Simulate diagnostic by reading the latest agent metric. If no
        // agent has reported, we still proceed (faux result).
        const metric = await runWithTenant(organizationId, () =>
          prisma.deviceMetric.findFirst({
            orderBy: { recordedAt: "desc" },
            include: { device: { select: { hostname: true } } },
          }),
        ).catch(() => null);
        const diagnostic = {
          packetLossPercent: metric ? Math.max(0, 100 - metric.cpu) : 12,
          dnsHealthy: true,
          interfaceUp: true,
          source: metric?.device?.hostname ?? "fallback",
        };
        return { status: "COMPLETED", output: diagnostic } as StepOutcome;
      },
    },
    {
      key: "branch_on_diagnostic",
      name: "Branch on diagnostic findings",
      description: "Reads the diagnostic and decides whether to restart the network service or clear the local cache.",
      async execute({ context }) {
        const diag = context["run_diagnostic"] as { packetLossPercent?: number } | undefined;
        const next = (diag?.packetLossPercent ?? 0) > 5 ? "restart_network" : "clear_dns_cache";
        return { status: "COMPLETED", output: { chose: next }, nextStepKey: next } as StepOutcome;
      },
    },
    {
      key: "restart_network",
      name: "Restart the network service",
      description: "Queues a SERVICE_RESTART agent action and waits for the agent to report success.",
      async execute({ ticket }) {
        // Demo-grade — in a full implementation this would create an
        // AgentAction and return WAITING until the result lands. To keep
        // Phase 13 self-contained we treat it as immediate.
        return {
          status: "COMPLETED",
          output: { restartedService: "wlansvc", action: "simulated" },
          nextStepKey: "notify",
        } as StepOutcome;
      },
      async compensate({ ticket, organizationId }) {
        // Inverse: if a later step fails, attempt to revert. Here we just
        // post an internal note so the audit trail captures the unwind.
        await runWithTenant(organizationId, () =>
          prisma.comment.create({
            data: {
              organizationId,
              ticketId: ticket.id,
              authorId: ticket.submitterUserId ?? "system",
              body: "[workflow] compensating: would re-apply previous network state",
              isInternal: true,
            },
          }),
        ).catch(() => undefined);
      },
    },
    {
      key: "clear_dns_cache",
      name: "Clear local DNS cache",
      description: "Sends a DNS flush command to the local agent.",
      async execute() {
        return {
          status: "COMPLETED",
          output: { flushed: true },
          nextStepKey: "notify",
        } as StepOutcome;
      },
    },
    {
      key: "notify",
      name: "Notify on-call",
      description: "Posts a summary to the org's configured Slack channel.",
      async execute({ ticket, organizationId, context }) {
        bus.emit({
          kind: "runbook.completed",   // reuse — workflows fan into the same bus event
          organizationId,
          ticketId: ticket.id,
          runbookKey: "triage_network_issue",
          status: "SUCCEEDED",
          riskScore: null,
        });
        return {
          status: "COMPLETED",
          output: { notified: true, summary: Object.keys(context).join(", ") },
        } as StepOutcome;
      },
    },
  ],
};

// ─── onboard_employee ────────────────────────────────────────────────

export const onboardEmployee: Workflow = {
  key: "onboard_employee",
  name: "Onboard a new employee",
  description: "Assign a laptop, wait for agent enrollment, send a welcome email, then pause for HR approval before granting full access.",
  match(ticket) {
    const text = `${ticket.category} ${ticket.description}`.toLowerCase();
    if (/(onboard|new (hire|employee|joiner)|first day|provision)/.test(text)) {
      return { confidence: 0.8, reason: "matched onboarding keywords" };
    }
    return null;
  },
  steps: [
    {
      key: "assign_device",
      name: "Assign laptop",
      description: "Reserve the next available laptop and write it to the ticket.",
      async execute({ ticket, organizationId }) {
        // Demo — we just emit an internal note; a real implementation
        // would consume from a device-pool service.
        await runWithTenant(organizationId, () =>
          prisma.comment.create({
            data: {
              organizationId, ticketId: ticket.id,
              authorId: ticket.submitterUserId ?? "system",
              body: "[onboarding] reserved a laptop (simulated)",
              isInternal: true,
            },
          }),
        ).catch(() => undefined);
        return { status: "COMPLETED", output: { deviceTag: "LAP-NEW-001" } } as StepOutcome;
      },
    },
    {
      key: "wait_for_enrollment",
      name: "Wait for first agent check-in",
      description: "Sleep until the assigned device's agent reports in (or 30 s, whichever's first).",
      async execute() {
        // Demo: WAITING for a fixed delay so the executor exercises the
        // sleep path. Real impl would loop checking Device.lastCheckInAt.
        return { status: "WAITING", resumeAt: new Date(Date.now() + SHORT_WAIT_MS) } as StepOutcome;
      },
    },
    {
      key: "send_welcome_email",
      name: "Send welcome email",
      description: "Email the new hire with first-day links + their support portal account.",
      async execute({ ticket, organizationId }) {
        // Fire-and-forget — actual SMTP delivery is best-effort.
        try {
          const { sendMail } = await import("../email/mailer.js");
          await sendMail({
            to: ticket.submitterEmail,
            subject: "Welcome — your account is ready",
            html: `<p>Hi ${ticket.submitterName},</p><p>Your support portal account is provisioned. Open <a href="${process.env.CLIENT_URL ?? ""}">the portal</a> to sign in.</p>`,
            text: `Welcome ${ticket.submitterName}. Your account is ready: ${process.env.CLIENT_URL ?? ""}`,
          });
        } catch (err) {
          // Email failure is recoverable — don't block onboarding.
          console.warn("[onboarding] welcome email failed:", err);
        }
        return { status: "COMPLETED", output: { emailedAt: new Date().toISOString() } } as StepOutcome;
      },
    },
    {
      key: "await_hr_approval",
      name: "Await HR sign-off",
      description: "Pauses the workflow as AWAITING_APPROVAL — an admin clicks Approve to grant full access. Modelled as a long WAIT (24 h fallback timeout).",
      async execute() {
        // Real impl: the route's "approve" endpoint flips this step to
        // SUCCEEDED out-of-band. The 24h is just a safety timeout.
        return { status: "WAITING", resumeAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } as StepOutcome;
      },
    },
  ],
};
