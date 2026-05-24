import type { Runbook } from "./types.js";

/**
 * password_reset — LOW risk.
 *   Match:   category = "Account & Access" AND mentions password+reset/forgot/lost,
 *            but NOT MFA/2FA (that's mfa_reset's territory).
 *   Execute: simulates an IdP password-reset email + closes the ticket.
 */
export const passwordResetRunbook: Runbook = {
  key: "password_reset",
  name: "Self-service password reset",
  description: "When a user reports they forgot or need to reset their password, send the IdP password-reset link and close the ticket.",
  risk: "LOW",

  match({ ticket, triage }) {
    if (triage.category !== "Account & Access") return { confidence: 0, reason: "wrong category" };
    const txt = ticket.description.toLowerCase();
    const mentionsPassword = /\bpassword\b/.test(txt) || /\bpwd\b/.test(txt);
    const mentionsReset    = /\b(reset|forgot|lost|change|expired|stuck)\b/.test(txt);
    const mentionsMfa      = /\b(mfa|2fa|totp|authenticator)\b/.test(txt);
    const mentionsLocked   = /\b(locked|locked\s+out)\b/.test(txt);
    if (mentionsMfa || mentionsLocked) return { confidence: 0, reason: "claimed by mfa_reset / account_unlock" };
    if (!mentionsPassword) return { confidence: 0, reason: "no 'password' keyword" };
    return {
      confidence: mentionsReset ? 0.9 : 0.6,
      reason: `password${mentionsReset ? " + reset" : ""} keywords matched`,
    };
  },

  async execute({ ticket }) {
    // In a real deployment this would POST to your IdP (Entra, Okta, Google) to
    // initiate a self-service reset. For the demo we just describe what we did.
    return {
      status: "SUCCEEDED",
      closeTicket: true,
      publicComment:
        `Hi ${ticket.submitterName.split(" ")[0] ?? "there"} — I've triggered a password reset for ${ticket.submitterEmail}.\n` +
        `\n` +
        `Check your inbox for the reset link (it expires in 1 hour). If you don't receive it within 5 minutes, reply here and I'll loop in a human.\n` +
        `\n` +
        `— Relay auto-remediation`,
      internalNote: `Auto-fired password_reset for ${ticket.submitterEmail}.`,
      decision: {
        action: "send_password_reset_link",
        target: ticket.submitterEmail,
        provider: "simulated",
      },
    };
  },
};
