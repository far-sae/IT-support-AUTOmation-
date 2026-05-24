import type { Runbook } from "./types.js";

/**
 * account_unlock — LOW risk.
 *   Match:   Account & Access + "locked"/"locked out"/"can't sign in".
 *   Execute: simulates unlocking the user's IdP account + closes the ticket.
 */
export const accountUnlockRunbook: Runbook = {
  key: "account_unlock",
  name: "Account unlock",
  description: "When a user is locked out after too many failed sign-ins, unlock their account at the IdP and close the ticket.",
  risk: "LOW",

  match({ ticket, triage }) {
    if (triage.category !== "Account & Access") return { confidence: 0, reason: "wrong category" };
    const txt = ticket.description.toLowerCase();
    const mentionsLocked = /\b(locked\s+out|locked|account\s+lock|too\s+many\s+attempts)\b/.test(txt);
    if (!mentionsLocked) return { confidence: 0, reason: "no lock-out keywords" };
    return { confidence: 0.9, reason: "explicit lock-out reference" };
  },

  async execute({ ticket }) {
    return {
      status: "SUCCEEDED",
      closeTicket: true,
      publicComment:
        `Hi ${ticket.submitterName.split(" ")[0] ?? "there"} — I've unlocked the ${ticket.submitterEmail} account. You can sign in now.\n` +
        `\n` +
        `If you're still seeing the lockout message after a fresh browser session, reply here and I'll escalate.\n` +
        `\n` +
        `— Relay auto-remediation`,
      internalNote: `Auto-fired account_unlock for ${ticket.submitterEmail}.`,
      decision: {
        action: "unlock_account",
        target: ticket.submitterEmail,
        provider: "simulated",
      },
    };
  },
};
