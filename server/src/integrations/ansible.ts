/**
 * Phase 14 — Ansible adapter.
 *
 * Wraps `ansible-playbook` invocations. The playbook path + inventory + extra
 * vars come from `Organization.settings.ansiblePlaybooks[*]`.
 *
 * Inventory can be a file path or a comma-separated host list (Ansible
 * accepts both — a comma at the end makes it a literal host list, e.g.
 * "1.2.3.4,").
 *
 * Output is captured + capped + 10 minutes of wall-clock are allowed by
 * default.
 */

import { spawn } from "node:child_process";
import { env } from "../env.js";

const OUTPUT_CAP = 10_000;

export interface AnsibleRunArgs {
  playbook: string;
  inventory: string;
  extraVars?: Record<string, string>;
  timeoutMs?: number;
}

export interface AnsibleRunResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
}

export async function runAnsible(args: AnsibleRunArgs): Promise<AnsibleRunResult> {
  const start = Date.now();
  const cliArgs: string[] = [args.playbook, "-i", args.inventory];
  if (args.extraVars && Object.keys(args.extraVars).length > 0) {
    const e = Object.entries(args.extraVars).map(([k, v]) => `${k}=${v}`).join(" ");
    cliArgs.push("-e", e);
  }

  return new Promise<AnsibleRunResult>((resolve) => {
    let output = "";
    let exited = false;
    const child = spawn(env.ANSIBLE_BIN, cliArgs, {
      env: { ...process.env, ANSIBLE_FORCE_COLOR: "0", ANSIBLE_HOST_KEY_CHECKING: "False" },
    });
    const append = (chunk: Buffer | string) => {
      if (output.length >= OUTPUT_CAP) return;
      output += chunk.toString().slice(0, OUTPUT_CAP - output.length);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      if (exited) return;
      child.kill("SIGKILL");
      output += "\n[ansible] killed: timeout";
    }, args.timeoutMs ?? 10 * 60 * 1000);
    child.on("error", (err) => {
      if (exited) return;
      exited = true;
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, output: `[ansible] spawn failed: ${err.message}\n${output}`, durationMs: Date.now() - start });
    });
    child.on("close", (code) => {
      if (exited) return;
      exited = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, output, durationMs: Date.now() - start });
    });
  });
}
