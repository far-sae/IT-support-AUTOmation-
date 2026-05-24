import type { Runbook } from "./types.js";

/**
 * license_assign — LOW risk.
 *   Match:   Software category + "license"/"licence"/"activation".
 *   Execute: pretends to assign from the catalog + closes the ticket.
 */
export const licenseAssignRunbook: Runbook = {
  key: "license_assign",
  name: "Assign software licence",
  description: "When a user reports a missing licence (Office, Adobe, etc.) check the pool and auto-assign one to them.",
  risk: "LOW",

  match({ ticket, triage }) {
    if (triage.category !== "Software") return { confidence: 0, reason: "wrong category" };
    const txt = ticket.description.toLowerCase();
    const mentionsLicense = /\b(licen[sc]e|activation|seat)\b/.test(txt);
    if (!mentionsLicense) return { confidence: 0, reason: "no licence/activation keywords" };
    return { confidence: 0.82, reason: "licence/activation reference" };
  },

  async execute({ ticket }) {
    return {
      status: "SUCCEEDED",
      closeTicket: true,
      publicComment:
        `Hi ${ticket.submitterName.split(" ")[0] ?? "there"} — I've assigned an available licence to ${ticket.submitterEmail}. ` +
        `Sign out of the app and back in to pick it up; activation usually completes within ~60 seconds.\n` +
        `\n` +
        `— Relay auto-remediation`,
      internalNote: `Auto-fired license_assign for ${ticket.submitterEmail}.`,
      decision: {
        action: "assign_license_from_pool",
        target: ticket.submitterEmail,
        provider: "simulated",
      },
    };
  },
};
