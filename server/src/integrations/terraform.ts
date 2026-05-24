/**
 * Phase 14 — Terraform CLI adapter.
 *
 * Wraps `terraform plan` and `terraform apply` invocations from inside
 * a runbook. The workspace directory + vars come from
 * `Organization.settings.terraformWorkspaces[*]`; the binary itself is
 * `env.TERRAFORM_BIN` (default "terraform").
 *
 * Output is captured (stdout+stderr), capped at 10 KB so a chatty plan
 * doesn't blow up our DB row. Non-zero exit ⇒ failure.
 *
 * Safety:
 *   • Working directory is server-defined (path on disk), so this isn't
 *     a path-traversal vector even though the workspace key is user-input.
 *   • The wrapping runbook is HIGH-risk so it can never bypass the
 *     AWAITING_AGENT one-click approval flow.
 */

import { spawn } from "node:child_process";
import { env } from "../env.js";

const OUTPUT_CAP = 10_000;

export interface TerraformRunArgs {
  workdir: string;
  vars?: Record<string, string>;
  /** Override "apply" for "plan" (read-only). */
  command?: "apply" | "plan" | "destroy";
  /** Defaults to 10 min. Hard kill after this. */
  timeoutMs?: number;
}

export interface TerraformRunResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
}

export async function runTerraform(args: TerraformRunArgs): Promise<TerraformRunResult> {
  const start = Date.now();
  const command = args.command ?? "apply";
  const cliArgs: string[] = [command, "-input=false", "-no-color"];
  if (command === "apply" || command === "destroy") cliArgs.push("-auto-approve");
  for (const [k, v] of Object.entries(args.vars ?? {})) {
    cliArgs.push("-var", `${k}=${v}`);
  }

  return new Promise<TerraformRunResult>((resolve) => {
    let output = "";
    let exited = false;
    const child = spawn(env.TERRAFORM_BIN, cliArgs, {
      cwd: args.workdir,
      env: { ...process.env, TF_IN_AUTOMATION: "1" },
    });
    const append = (chunk: Buffer | string) => {
      if (output.length >= OUTPUT_CAP) return;
      const remain = OUTPUT_CAP - output.length;
      output += chunk.toString().slice(0, remain);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      if (exited) return;
      child.kill("SIGKILL");
      output += "\n[terraform] killed: timeout";
    }, args.timeoutMs ?? 10 * 60 * 1000);
    child.on("error", (err) => {
      if (exited) return;
      exited = true;
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, output: `[terraform] spawn failed: ${err.message}\n${output}`, durationMs: Date.now() - start });
    });
    child.on("close", (code) => {
      if (exited) return;
      exited = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, output, durationMs: Date.now() - start });
    });
  });
}
