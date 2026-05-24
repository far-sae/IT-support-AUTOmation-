/**
 * ansible_playbook — HIGH risk.
 *
 *   Match:   ticket text mentions ansible / playbook by name.
 *   Execute: shells out to `ansible-playbook -i inventory playbook.yml`.
 *            Output capped at 10 KB and stored on decision.ansibleOutput.
 */

import type { Runbook } from "./types.js";
import { basePrismaUnscoped } from "../db.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { runAnsible } from "../integrations/ansible.js";

export const ansiblePlaybookRunbook: Runbook = {
  key: "ansible_playbook",
  name: "Run an Ansible playbook",
  description: "Executes a pre-configured Ansible playbook against its inventory. HIGH risk — requires admin approval.",
  risk: "HIGH",

  match({ ticket }) {
    const t = ticket.description.toLowerCase();
    if (/\b(ansible|playbook)\b/.test(t)) return { confidence: 0.8, reason: "ansible/playbook mentioned" };
    return { confidence: 0, reason: "no ansible keyword" };
  },

  async execute({ ticket }) {
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: ticket.organizationId }, select: { settings: true },
    });
    const settings = parseOrgSettings(org?.settings);
    const playbook = settings.ansiblePlaybooks?.[0];
    if (!playbook) {
      return {
        status: "FAILED",
        publicComment: "",
        internalNote: "[ansible_playbook] no playbook configured (Organization.settings.ansiblePlaybooks[0]).",
        decision: { error: "no playbook" },
      };
    }

    const result = await runAnsible({
      playbook: playbook.path,
      inventory: playbook.inventory,
      extraVars: playbook.extraVars,
    });
    return {
      status: result.ok ? "AWAITING_VERIFICATION" : "FAILED",
      publicComment: result.ok
        ? "Configuration management has been applied. I'll close this ticket once the verification window passes.\n\n— Relay autopilot"
        : "",
      internalNote: result.ok
        ? `[ansible_playbook] ran '${playbook.key}' in ${result.durationMs} ms`
        : `[ansible_playbook] failed (exit ${result.exitCode}). Tail of output:\n${result.output.slice(-800)}`,
      decision: {
        action: "ansible_playbook",
        playbookKey: playbook.key,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        ansibleOutput: result.output,
      },
    };
  },
};
