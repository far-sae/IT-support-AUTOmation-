import type { Runbook } from "./types.js";

/**
 * mfa_reset — MEDIUM risk (asks the user to confirm via Yes/No before closing).
 *   Match:   Account & Access + MFA / 2FA / authenticator keywords.
 *   Execute: simulates clearing the user's MFA enrollment so they can re-enroll.
 */
export const mfaResetRunbook: Runbook = {
  key: "mfa_reset",
  name: "MFA re-enrollment",
  description: "When the user can't get past MFA, clear their existing enrollment so they can register a new device on next sign-in.",
  risk: "MEDIUM",

  match({ ticket, triage }) {
    if (triage.category !== "Account & Access") return { confidence: 0, reason: "wrong category" };
    const txt = ticket.description.toLowerCase();
    const mentionsMfa = /\b(mfa|2fa|totp|authenticator)\b/.test(txt);
    if (!mentionsMfa) return { confidence: 0, reason: "no MFA keyword" };
    const mentionsTrouble = /\b(reset|not working|stuck|lost|broken|loop)\b/.test(txt);
    return {
      confidence: mentionsTrouble ? 0.88 : 0.65,
      reason: `mfa${mentionsTrouble ? " + reset/trouble" : ""} keywords matched`,
    };
  },

  async execute({ ticket }) {
    return {
      status: "AWAITING_USER",
      publicComment:
        `Hi ${ticket.submitterName.split(" ")[0] ?? "there"} — I've cleared your MFA enrollment for ${ticket.submitterEmail}. ` +
        `Next time you sign in you'll be asked to register a new device.\n` +
        `\n` +
        `Could you give it a try and let me know whether you're back in? Use the **Yes, it worked** / **No, still broken** buttons on this ticket.\n` +
        `\n` +
        `— Relay auto-remediation`,
      internalNote: `Auto-fired mfa_reset for ${ticket.submitterEmail}. Awaiting user confirmation.`,
      decision: {
        action: "clear_mfa_enrollment",
        target: ticket.submitterEmail,
        provider: "simulated",
      },
    };
  },
};
