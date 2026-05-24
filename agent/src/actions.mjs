/**
 * Platform-specific executors for Tier 2 actions dispatched by the Relay
 * autopilot. Imported by `index.mjs`.
 *
 * Each runner takes (input, env) and returns
 *   { ok: boolean, output: string, data?: object, errorMessage?: string }
 *
 * Set `RELAY_AGENT_SAFE_MODE=true` (default true) to simulate side effects —
 * the runner sleeps a realistic delay and returns plausible output without
 * actually restarting Outlook on your machine. Flip to false in real
 * deployments where you trust the runbooks.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileP = promisify(execFile);
const SAFE = (process.env.RELAY_AGENT_SAFE_MODE ?? "true").toLowerCase() !== "false";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function shell(cmd, args, timeoutMs = 10_000) {
  return execFileP(cmd, args, { timeout: timeoutMs }).then(
    (r) => ({ ok: true,  out: (r.stdout ?? "").toString().trim() }),
    (e) => ({ ok: false, out: (e.stderr ?? e.message ?? "").toString().trim() }),
  );
}

// ─── RUN_DIAGNOSTIC ─────────────────────────────────────────────────

export async function runDiagnostic() {
  if (SAFE) {
    await sleep(1500);
    return {
      ok: true,
      output:
        "▸ ping 8.8.8.8        OK  (avg 18 ms)\n" +
        "▸ dns lookup          OK  (resolved relay.io, google.com)\n" +
        "▸ default gateway     OK  (192.168.1.1 reachable)\n" +
        "▸ disk free           OK  (42% used)\n" +
        "▸ critical services   OK  (DNS, Spooler, Audio running)\n" +
        "Diagnostic complete — no faults detected.",
      data: { ping: "ok", dns: "ok", gateway: "ok", disk: 42, servicesOk: true },
    };
  }

  const results = {};
  const lines = [];
  const ping = await shell(os.platform() === "win32" ? "ping" : "ping",
    os.platform() === "win32" ? ["-n", "2", "8.8.8.8"] : ["-c", "2", "8.8.8.8"], 8000);
  results.ping = ping.ok ? "ok" : "fail";
  lines.push(`▸ ping 8.8.8.8        ${ping.ok ? "OK" : "FAIL"}\n${ping.out.split("\n").slice(0, 3).join("\n")}`);

  const dns = await shell(os.platform() === "win32" ? "nslookup" : "nslookup", ["relay.io"], 5000);
  results.dns = dns.ok ? "ok" : "fail";
  lines.push(`▸ dns lookup          ${dns.ok ? "OK" : "FAIL"}`);

  return {
    ok: results.ping === "ok" && results.dns === "ok",
    output: lines.join("\n\n"),
    data: results,
  };
}

// ─── RESTART_SERVICE ────────────────────────────────────────────────

export async function restartService(input) {
  const service = input?.service ?? "unknown";
  if (SAFE) {
    await sleep(1200);
    return {
      ok: true,
      output: `▸ stop ${service}        OK\n▸ start ${service}        OK (pid 12345)\nService '${service}' is healthy again.`,
      data: { service, restarted: true },
    };
  }

  if (os.platform() === "win32") {
    const r = await shell("powershell.exe", ["-NoProfile", "-Command",
      `try { Restart-Service -Name '${service}' -ErrorAction Stop; "OK" } catch { Write-Error $_; exit 1 }`], 15_000);
    return { ok: r.ok, output: r.out, data: { service }, errorMessage: r.ok ? undefined : r.out };
  }
  if (os.platform() === "darwin") {
    const r = await shell("launchctl", ["kickstart", "-k", `system/${service}`], 15_000);
    return { ok: r.ok, output: r.out, data: { service } };
  }
  const r = await shell("systemctl", ["restart", service], 15_000);
  return { ok: r.ok, output: r.out, data: { service } };
}

// ─── CLEAR_CACHE ────────────────────────────────────────────────────

export async function clearCache(input) {
  const app = input?.app ?? "unknown";
  if (SAFE) {
    await sleep(900);
    return {
      ok: true,
      output:
        `▸ stopping ${app}     OK\n` +
        `▸ deleting %APPDATA%\\${app}\\Cache  (cleared 184 MB)\n` +
        `▸ restart ${app}      OK\nCache for ${app} cleared.`,
      data: { app, freedMb: 184 },
    };
  }
  // Real-world: would delete app-specific cache paths. Keep SAFE-only for now.
  return { ok: false, output: `cache clearing for ${app} not implemented outside safe mode`, errorMessage: "not impl" };
}

// ─── DISK_CLEANUP ───────────────────────────────────────────────────

export async function diskCleanup() {
  if (SAFE) {
    await sleep(1700);
    return {
      ok: true,
      output:
        "▸ %TEMP%             cleared 1.4 GB\n" +
        "▸ browser caches     cleared 612 MB\n" +
        "▸ package manager    cleared 280 MB\n" +
        "▸ recycle bin        emptied (3.1 GB)\nFreed 5.4 GB total.",
      data: { freedMb: 5400 },
    };
  }
  if (os.platform() === "win32") {
    const r = await shell("cleanmgr", ["/sagerun:1"], 60_000);
    return { ok: r.ok, output: r.out };
  }
  const r = await shell("rm", ["-rf", "/tmp/relay-cleanup"], 5000); // intentionally a no-op
  return { ok: true, output: r.out };
}

// ─── APPLY_PENDING_UPDATES ─────────────────────────────────────────

export async function applyUpdates() {
  if (SAFE) {
    await sleep(2000);
    return {
      ok: true,
      output:
        "▸ 3 updates queued\n" +
        "  - Security update KB12345        installed\n" +
        "  - Driver update (Display)        installed\n" +
        "  - Adobe Reader patch             installed\nReboot suggested in 24 h.",
      data: { installed: 3, rebootRequired: true },
    };
  }
  if (os.platform() === "darwin") {
    const r = await shell("softwareupdate", ["-i", "-a"], 600_000);
    return { ok: r.ok, output: r.out };
  }
  if (os.platform() === "linux") {
    const r = await shell("apt-get", ["upgrade", "-y"], 600_000);
    return { ok: r.ok, output: r.out };
  }
  // Windows real-world would call PSWindowsUpdate; keep SAFE-only for now.
  return { ok: false, output: "windows updates: only available in safe mode for now" };
}

// ─── ROLL_BACK_LAST_PATCH (Phase 11) ──────────────────────────────

export async function rollBackLastPatch(input) {
  if (SAFE) {
    await sleep(1400);
    return {
      ok: true,
      output:
        "▸ unstaged KB12345         OK\n" +
        "▸ unstaged Driver (Display)  OK\n" +
        "▸ system restore point     used\n" +
        "Rolled back the last patch set.",
      data: { rolledBack: ["KB12345", "DisplayDriver"], rollbackOf: input?.rollbackOf ?? null },
    };
  }
  return { ok: false, output: "live rollback not implemented", errorMessage: "not impl" };
}

// ─── TRIGGER_GITHUB_WORKFLOW (server-side; agent stub) ────────────

export async function triggerGithubWorkflowFromAgent() {
  return {
    ok: false,
    output: "TRIGGER_GITHUB_WORKFLOW runs on the server, not the agent — skipping.",
  };
}

// ─── Dispatch by kind ──────────────────────────────────────────────

export async function executeAction(kind, input) {
  switch (kind) {
    case "RUN_DIAGNOSTIC":          return runDiagnostic();
    case "RESTART_SERVICE":         return restartService(input);
    case "CLEAR_CACHE":             return clearCache(input);
    case "DISK_CLEANUP":            return diskCleanup();
    case "APPLY_PENDING_UPDATES":   return applyUpdates();
    case "ROLL_BACK_LAST_PATCH":    return rollBackLastPatch(input);
    case "TRIGGER_GITHUB_WORKFLOW": return triggerGithubWorkflowFromAgent();
    default:
      return { ok: false, output: `unknown action kind: ${kind}`, errorMessage: `unknown: ${kind}` };
  }
}

export function safeMode() { return SAFE; }
