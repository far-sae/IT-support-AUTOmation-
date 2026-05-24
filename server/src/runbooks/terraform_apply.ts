/**
 * terraform_apply — HIGH risk.
 *
 *   Match:   ticket text explicitly mentions terraform OR a configured
 *            workspace key. We don't auto-fire from generic "deploy"
 *            language — the github_dispatch runbook covers CI-style ops.
 *
 *   Execute: shells out to `terraform apply` against the workspace path.
 *            Output is captured (capped at 10 KB) and stored on
 *            RunbookExecution.decision.terraformOutput.
 *
 * Policy: HIGH risk means the engine creates the execution row as
 * AWAITING_AGENT — execute() runs only after an admin clicks Approve in
 * the Co-pilot panel. Same gating as github_dispatch.
 */

import type { Runbook } from "./types.js";
import { basePrismaUnscoped } from "../db.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { runTerraform } from "../integrations/terraform.js";
import { env } from "../env.js";

export const terraformApplyRunbook: Runbook = {
  key: "terraform_apply",
  name: "Apply a Terraform workspace",
  description: "Runs `terraform apply` against a configured workspace. HIGH risk — requires admin approval.",
  risk: "HIGH",

  match({ ticket }) {
    const t = ticket.description.toLowerCase();
    if (/\bterraform\s+(apply|plan|destroy)\b/.test(t)) return { confidence: 0.85, reason: "terraform CLI mentioned" };
    if (/\bredeploy\s+infrastructure\b/.test(t))         return { confidence: 0.6,  reason: "redeploy infra phrase" };
    return { confidence: 0, reason: "no terraform keyword" };
  },

  async execute({ ticket }) {
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: ticket.organizationId }, select: { settings: true },
    });
    const settings = parseOrgSettings(org?.settings);
    // Pick the workspace — first configured, OR the env default.
    const workspace = settings.terraformWorkspaces?.[0];
    const workdir = workspace?.path ?? env.TERRAFORM_DEFAULT_WORKDIR;
    if (!workdir) {
      return {
        status: "FAILED",
        publicComment: "",
        internalNote: "[terraform_apply] no workspace configured (Organization.settings.terraformWorkspaces[0].path or TERRAFORM_DEFAULT_WORKDIR).",
        decision: { error: "no workspace" },
      };
    }

    const result = await runTerraform({
      workdir, vars: workspace?.vars, command: "apply",
    });
    return {
      status: result.ok ? "AWAITING_VERIFICATION" : "FAILED",
      publicComment: result.ok
        ? "Infrastructure changes have been applied. I'll close this ticket once the verification window passes.\n\n— Relay autopilot"
        : "",
      internalNote: result.ok
        ? `[terraform_apply] applied workspace '${workspace?.key ?? "(default)"}' in ${result.durationMs} ms`
        : `[terraform_apply] failed (exit ${result.exitCode}). Tail of output:\n${result.output.slice(-800)}`,
      decision: {
        action: "terraform_apply",
        workspaceKey: workspace?.key ?? null,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        terraformOutput: result.output,
      },
    };
  },
};
