/**
 * github_dispatch — HIGH risk (escalates by default; tightened by policies).
 *
 *   Match:   ticket mentions explicit ops keywords ("deploy", "rebuild",
 *            "redeploy", "rotate secret", "run CI") AND the org has
 *            `githubRepo` configured.
 *   Execute: server-side POST to GitHub workflow_dispatch. The action
 *            row is created with kind=TRIGGER_GITHUB_WORKFLOW + already
 *            marked SUCCEEDED/FAILED (no agent involvement).
 *
 * Why HIGH risk: a workflow can do anything. Default policy holds it for
 * agent approval unless an admin disables `require_approval_for_high_risk`.
 */

import { AgentActionKind, AgentActionStatus } from "@prisma/client";
import type { Runbook } from "./types.js";
import { basePrismaUnscoped, prisma } from "../db.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { dispatchWorkflow, parseRepoSlug } from "../integrations/github.js";
import { findTicketDevice } from "./agentActions.js";

export const githubDispatchRunbook: Runbook = {
  key: "github_dispatch",
  name: "Trigger a GitHub Actions workflow",
  description: "Fires a workflow_dispatch on the org's configured GitHub repo when the ticket asks for a CI-style operation (deploy, rebuild, rotate-secret). HIGH risk by default.",
  risk: "HIGH",

  match({ ticket }) {
    const t = ticket.description.toLowerCase();
    const opsHit = /\b(deploy(ment)?|redeploy|rebuild|rotate\s+(secret|token|key)|trigger\s+(workflow|build|pipeline)|kick\s+off\s+(ci|build))\b/.test(t);
    if (!opsHit) return { confidence: 0, reason: "no ops keyword" };
    return { confidence: 0.75, reason: "ops keyword detected" };
  },

  async execute(ctx) {
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: ctx.ticket.organizationId }, select: { settings: true },
    });
    const settings = parseOrgSettings(org?.settings);
    const repo = parseRepoSlug(settings.githubRepo);
    if (!repo) {
      return {
        status: "FAILED",
        publicComment: "",
        internalNote: "[github_dispatch] org has no `githubRepo` configured.",
        decision: { error: "no githubRepo" },
      };
    }

    // Pick a device so the AgentAction has a target (required by the FK).
    const device = await findTicketDevice({
      organizationId: ctx.ticket.organizationId, submitterName: ctx.ticket.submitterName,
    });
    if (!device) {
      return {
        status: "FAILED",
        publicComment: "",
        internalNote: "[github_dispatch] no device to attach the action to.",
        decision: { error: "no device" },
      };
    }

    const exec = await prisma.runbookExecution.findFirst({
      where: { ticketId: ctx.ticket.id, runbookKey: "github_dispatch" },
      orderBy: { startedAt: "desc" },
    });

    // Create the action row as IN_PROGRESS, then do the actual HTTP call,
    // then update with the outcome. The action row is the audit trail.
    const action = await prisma.agentAction.create({
      data: {
        organizationId: ctx.ticket.organizationId,
        deviceId: device.id,
        kind: AgentActionKind.TRIGGER_GITHUB_WORKFLOW,
        input: {
          owner: repo.owner, repo: repo.repo,
          workflowFile: "relay-action.yml",
          ref: "main",
          inputs: { ticket: ctx.ticket.refCode, description: ctx.ticket.description.slice(0, 200) },
        } as object,
        status: AgentActionStatus.IN_PROGRESS,
        dispatchedAt: new Date(),
        runbookExecutionId: exec?.id,
      },
    });

    const result = await dispatchWorkflow({
      owner: repo.owner, repo: repo.repo,
      workflowFile: "relay-action.yml",
      ref: "main",
      inputs: { ticket: ctx.ticket.refCode, description: ctx.ticket.description.slice(0, 200) },
    });

    await prisma.agentAction.update({
      where: { id: action.id },
      data: {
        status: result.ok ? AgentActionStatus.SUCCEEDED : AgentActionStatus.FAILED,
        result: { ok: result.ok, output: result.output, statusCode: result.statusCode ?? null } as object,
        completedAt: new Date(),
      },
    });

    return {
      // Even on success we wait for verification — the workflow might take minutes.
      status: result.ok ? "AWAITING_VERIFICATION" : "FAILED",
      publicComment: result.ok
        ? `Hi ${ctx.ticket.submitterName.split(" ")[0] ?? "there"} — I've kicked off the ${repo.owner}/${repo.repo} workflow. ` +
          `It usually completes in a few minutes; I'll close this ticket once the verification window is clear.\n\n— Relay autopilot`
        : "",
      internalNote: result.ok
        ? `Dispatched workflow_dispatch on ${repo.owner}/${repo.repo}@main (action ${action.id}).`
        : `[github_dispatch] ${result.output}`,
      decision: {
        action: "github_dispatch",
        repo: settings.githubRepo,
        actionId: action.id,
        githubResponse: result.statusCode,
      },
    };
  },
};
