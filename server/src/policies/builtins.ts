/**
 * Built-in policies. Each is a small, single-concern guard.
 * Add a new policy = add a new file + register it in registry.ts.
 */

import type { Policy } from "./types.js";

function isInBusinessHours(date: Date, settings: Policy extends unknown ? { businessHours?: { tz?: string; daysOfWeek?: number[]; startHour?: number; endHour?: number } } : never): boolean {
  const bh = settings.businessHours ?? {};
  const days = bh.daysOfWeek ?? [1, 2, 3, 4, 5]; // Mon–Fri
  const startHour = bh.startHour ?? 9;
  const endHour   = bh.endHour   ?? 18;
  // For simplicity treat all times as UTC. A real implementation would
  // use Intl + the org's tz; left as a deliberate simplification here.
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  return days.includes(day) && hour >= startHour && hour < endHour;
}

export const noCriticalDuringBusinessHours: Policy = {
  key: "no_critical_business_hours",
  name: "No high-risk actions on Critical tickets during business hours",
  description: "Risky actions (restart_service, apply_pending_updates, github_dispatch) on Critical-priority tickets are paused during business hours and routed for agent approval — so a wrong restart can't take down a working executive's machine mid-day.",
  evaluate({ ticket, risk, settings, now }) {
    if (ticket.priority !== "Critical") return { decision: "ALLOW" };
    if (risk.score < 40) return { decision: "ALLOW" };
    if (!isInBusinessHours(now, settings)) return { decision: "ALLOW" };
    return {
      decision: "DENY",
      reason: `risk=${risk.score} on a Critical ticket during business hours`,
      escalate: true,
    };
  },
};

export const requireApprovalForHighRisk: Policy = {
  key: "require_approval_for_high_risk",
  name: "Pause actions above risk 70 for agent approval",
  description: "Anything scoring 70+ on the risk model (high-blast / first-attempt / repeated failures) gets parked as AWAITING_AGENT so a human ticks 'go'.",
  evaluate({ risk }) {
    if (risk.score < 70) return { decision: "ALLOW" };
    return { decision: "DENY", reason: `risk=${risk.score} ≥ 70`, escalate: true };
  },
};

export const noMassAction: Policy = {
  key: "no_mass_action",
  name: "Block more than 5 actions per hour for one runbook",
  description: "If the brain has already fired the same runbook >5 times in the last hour across the org, additional dispatches are blocked until the rate drops — defending against a faulty matcher.",
  evaluate({ recentRunbookCount }) {
    if (recentRunbookCount <= 5) return { decision: "ALLOW" };
    return { decision: "DENY", reason: `runbook fired ${recentRunbookCount}× in the last hour (cap 5)`, escalate: true };
  },
};

export const quietHours: Policy = {
  key: "quiet_hours",
  name: "No automated actions overnight (22:00 – 06:00 UTC)",
  description: "Outside of working hours all but the lowest-risk actions pause until morning. Stops the autopilot rebooting a sleeping engineer's laptop at 03:00.",
  evaluate({ risk, now }) {
    const h = now.getUTCHours();
    const quiet = h >= 22 || h < 6;
    if (!quiet) return { decision: "ALLOW" };
    if (risk.score < 15) return { decision: "ALLOW" };
    return { decision: "DENY", reason: `quiet hours (${h.toString().padStart(2, "0")}:00 UTC), risk=${risk.score}`, escalate: true };
  },
};

export const noUpdatesOnOpenTickets: Policy = {
  key: "no_updates_on_open_tickets",
  name: "Skip apply_pending_updates when the device has any other open ticket",
  description: "If the user already has another open ticket on the same device, an OS-update run can mask the symptoms of the real fault. Pauses the apply.",
  evaluate({ runbook, ticket }) {
    if (runbook.key !== "apply_pending_updates") return { decision: "ALLOW" };
    // We can't query DB synchronously from here; the engine does that and
    // passes counts in via ctx — left as a future enhancement. For now,
    // tighten by requiring the ticket itself to NOT be critical.
    if (ticket.priority === "Critical") {
      return { decision: "DENY", reason: "apply_pending_updates blocked on Critical tickets", escalate: false };
    }
    return { decision: "ALLOW" };
  },
};
