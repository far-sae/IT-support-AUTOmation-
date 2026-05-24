/**
 * Phase 11 — GitHub Actions integration.
 *
 * The brain can fire a `workflow_dispatch` on a configurable repo for two
 * patterns:
 *   • As a runbook (`github_dispatch`) when a ticket asks for an operation
 *     better expressed as a CI job (deploy, rebuild, rotate-secret).
 *   • As a manual co-pilot button on the device action panel.
 *
 * Auth is via `GITHUB_TOKEN` (env). Target repo per-org via
 * `Organization.settings.githubRepo` ("owner/repo"). Workflow file id
 * defaults to "relay-action.yml" — overridable per call.
 */

import { env } from "../env.js";

export interface GithubDispatchInput {
  owner: string;
  repo: string;
  workflowFile: string;        // e.g. "relay-action.yml"
  ref?: string;                // branch or tag (default "main")
  inputs?: Record<string, string>;
}

export interface GithubDispatchResult {
  ok: boolean;
  output: string;
  statusCode?: number;
}

/**
 * POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches.
 * Returns 204 on success — there's no run-id available from the immediate
 * response; we surface that fact to the caller.
 */
export async function dispatchWorkflow(input: GithubDispatchInput): Promise<GithubDispatchResult> {
  if (!env.GITHUB_TOKEN) {
    return { ok: false, output: "GITHUB_TOKEN not set on the server — workflow dispatch skipped." };
  }
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/actions/workflows/${input.workflowFile}/dispatches`;
  const body = JSON.stringify({
    ref: input.ref ?? "main",
    ...(input.inputs ? { inputs: input.inputs } : {}),
  });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "relay-autopilot/0.1.0",
      },
      body,
    });

    if (resp.status === 204) {
      return {
        ok: true,
        output: `Workflow ${input.workflowFile} dispatched on ${input.owner}/${input.repo}@${input.ref ?? "main"}.`,
        statusCode: 204,
      };
    }

    const text = await resp.text().catch(() => "");
    return {
      ok: false,
      output: `GitHub returned HTTP ${resp.status}: ${text.slice(0, 300)}`,
      statusCode: resp.status,
    };
  } catch (err) {
    return { ok: false, output: `Network error: ${(err as Error).message}` };
  }
}

export function parseRepoSlug(slug: string | undefined): { owner: string; repo: string } | null {
  if (!slug) return null;
  const m = slug.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}
