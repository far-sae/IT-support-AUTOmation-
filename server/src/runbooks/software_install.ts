import type { Runbook } from "./types.js";

/**
 * software_install — MEDIUM risk (awaits user confirmation after installation).
 *   Match:   "install <app>" pattern, typical apps in the description.
 *   Execute: simulates queuing the install via the self-service catalog.
 */
const KNOWN_APPS = ["slack", "zoom", "teams", "outlook", "office", "vs code", "vscode", "chrome", "firefox", "docker", "postman", "figma"];

export const softwareInstallRunbook: Runbook = {
  key: "software_install",
  name: "Self-service software install",
  description: "When a user asks for a common app (Slack, Zoom, VS Code, …), queue it via the self-service catalog and ask the user to confirm once it's done.",
  risk: "MEDIUM",

  match({ ticket }) {
    const txt = ticket.description.toLowerCase();
    // Need an explicit install verb to avoid pulling in "Slack keeps crashing".
    const mentionsInstall = /\b(install|set\s*up|need|get|push|deploy)\b/.test(txt);
    if (!mentionsInstall) return { confidence: 0, reason: "no install verb" };
    const app = KNOWN_APPS.find((a) => txt.includes(a));
    if (!app) return { confidence: 0, reason: "no known app keyword" };
    // Exclude "crash"/"freeze"/"broken" so a complaint about Slack doesn't
    // misroute to install.
    if (/\b(crash|freez|broken|error|down)/.test(txt)) {
      return { confidence: 0, reason: "looks like a fault, not an install request" };
    }
    return { confidence: 0.8, reason: `install request for "${app}"` };
  },

  async execute({ ticket }) {
    const txt = ticket.description.toLowerCase();
    const app = KNOWN_APPS.find((a) => txt.includes(a)) ?? "the requested app";

    return {
      status: "AWAITING_USER",
      publicComment:
        `Hi ${ticket.submitterName.split(" ")[0] ?? "there"} — I've queued **${app}** for install on your device via the self-service catalog. ` +
        `It should arrive in the next 10 minutes.\n` +
        `\n` +
        `Once you see it, please confirm with **Yes, it worked** below. If it hasn't arrived in 15 minutes, click **No, still broken** and we'll escalate.\n` +
        `\n` +
        `— Relay auto-remediation`,
      internalNote: `Auto-fired software_install for "${app}" → ${ticket.submitterEmail}.`,
      decision: {
        action: "queue_software_install",
        app,
        target: ticket.submitterEmail,
        provider: "simulated",
      },
    };
  },
};
