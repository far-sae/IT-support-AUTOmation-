#!/usr/bin/env node
/**
 * Relay agent — collects host metrics and POSTs them to /api/agent/checkin.
 *
 * Zero deps: Node stdlib only (`os`, `child_process`, `fs/promises`, `http`).
 * Works on Windows, macOS and Linux.
 *
 * Config sources (in priority order):
 *   1. Command-line flags (--api-url, --token, --interval, --hostname, --once)
 *   2. Environment variables (RELAY_API_URL, RELAY_ENROLLMENT_TOKEN,
 *      RELAY_AGENT_INTERVAL, RELAY_AGENT_HOSTNAME)
 *   3. ./relay-agent.json — see relay-agent.example.json
 *
 * Run once:        node src/index.mjs --once
 * Run as daemon:   node src/index.mjs            (defaults to every 60 s)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { executeAction, safeMode } from "./actions.mjs";

const execFileP = promisify(execFile);
const VERSION = "0.1.0";

// ─── Config loading ───────────────────────────────────────────────────

function parseFlags(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--once")          out.once = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[a.replace(/^--/, "")] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function loadFileConfig() {
  for (const p of ["relay-agent.json", path.join(process.cwd(), "relay-agent.json")]) {
    try {
      const raw = await readFile(p, "utf8");
      return JSON.parse(raw);
    } catch { /* not present */ }
  }
  return {};
}

async function resolveConfig() {
  const flags = parseFlags(process.argv);
  if (flags.help) {
    printUsage();
    process.exit(0);
  }
  const file = await loadFileConfig();
  const cfg = {
    apiUrl:  flags["api-url"]   || process.env.RELAY_API_URL          || file.apiUrl  || "http://localhost:4000",
    token:   flags.token        || process.env.RELAY_ENROLLMENT_TOKEN || file.token,
    interval: Number(flags.interval || process.env.RELAY_AGENT_INTERVAL || file.interval || 60),
    hostname: flags.hostname    || process.env.RELAY_AGENT_HOSTNAME    || file.hostname || os.hostname(),
    assignedUser: flags["assigned-user"] || process.env.RELAY_AGENT_USER || file.assignedUser,
    type: flags.type            || process.env.RELAY_AGENT_TYPE         || file.type,
    once: Boolean(flags.once),
  };
  if (!cfg.token) {
    console.error("error: enrollment token is required (set --token, RELAY_ENROLLMENT_TOKEN, or relay-agent.json)");
    printUsage();
    process.exit(1);
  }
  return cfg;
}

function printUsage() {
  console.log(`relay-agent ${VERSION}

Usage:
  relay-agent [--once] [--api-url URL] [--token TOKEN] [--interval SECONDS]
              [--hostname NAME] [--assigned-user NAME] [--type LAPTOP|DESKTOP|MOBILE]

Required:
  --token            Agent enrollment token (or RELAY_ENROLLMENT_TOKEN env, or in relay-agent.json)

Common:
  --api-url URL      Relay API base URL (default http://localhost:4000)
  --interval N       Seconds between check-ins (default 60)
  --once             Send one check-in and exit (good for cron)
  --hostname NAME    Override the OS hostname
  --assigned-user    Who this device belongs to (free-text)
  --type             LAPTOP | DESKTOP | MOBILE  (default LAPTOP)

Example config:
  See relay-agent.example.json next to this script.`);
}

// ─── Metric collection ───────────────────────────────────────────────

function osLabel() {
  // Eg. "Windows 11", "macOS 14.5", "Ubuntu 24.04"
  const platform = os.platform();
  const release = os.release();
  if (platform === "darwin") return `macOS ${release}`;
  if (platform === "win32")  return `Windows ${release}`;
  if (platform === "linux")  return `Linux ${release}`;
  return `${platform} ${release}`;
}

function cpuLoadPercent() {
  // Average load over 1 minute, scaled to CPU-count percentage.
  // os.loadavg() returns [1m, 5m, 15m] on Unix; on Windows it returns [0,0,0].
  const [l1] = os.loadavg();
  const cores = os.cpus().length;
  if (cores === 0 || l1 === 0) {
    // Fallback: sample a 200 ms slice of CPU time.
    return sampleCpu();
  }
  return Math.min(100, Math.max(0, Math.round((l1 / cores) * 100)));
}

function sampleCpu() {
  // Synchronous-feeling sample. Returns 0-100 based on a 200 ms gap.
  const cpusA = os.cpus();
  const a = cpusA.reduce((s, c) => {
    const t = c.times;
    return { idle: s.idle + t.idle, total: s.total + t.user + t.nice + t.sys + t.idle + t.irq };
  }, { idle: 0, total: 0 });
  // Busy-wait ~200ms — fine for an agent that runs once per N seconds.
  const start = Date.now();
  while (Date.now() - start < 200) { /* spin */ }
  const cpusB = os.cpus();
  const b = cpusB.reduce((s, c) => {
    const t = c.times;
    return { idle: s.idle + t.idle, total: s.total + t.user + t.nice + t.sys + t.idle + t.irq };
  }, { idle: 0, total: 0 });
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - (idleDelta / totalDelta) * 100)));
}

function ramPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100);
}

async function diskPercent() {
  // Walk to the root of the current drive and sample free / total.
  // Uses platform-specific commands; falls back to 0 if anything fails.
  try {
    if (os.platform() === "win32") {
      // Read the system drive (e.g. C:) via CIM.
      const { stdout } = await execFileP("powershell.exe", [
        "-NoProfile", "-Command",
        "$d = Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='$env:SystemDrive'\"; if ($d) { \"$($d.Size - $d.FreeSpace),$($d.Size)\" }",
      ], { timeout: 5000 });
      const [usedStr, totalStr] = stdout.trim().split(",");
      const used  = Number(usedStr  ?? 0);
      const total = Number(totalStr ?? 0);
      if (total <= 0) return 0;
      return Math.round((used / total) * 100);
    } else {
      // df -kP / on macOS + Linux.
      const { stdout } = await execFileP("df", ["-kP", "/"], { timeout: 5000 });
      const parts = stdout.trim().split(/\n/)[1]?.split(/\s+/);
      const used = Number(parts?.[2] ?? 0);
      const available = Number(parts?.[3] ?? 0);
      const total = used + available;
      if (total <= 0) return 0;
      return Math.round((used / total) * 100);
    }
  } catch {
    return 0;
  }
}

async function pendingUpdates() {
  // Best-effort heuristic; on the seed/demo machines this is meaningless.
  // Returns a count; the server's threshold logic picks the bucket.
  try {
    if (os.platform() === "darwin") {
      const { stdout } = await execFileP("softwareupdate", ["-l"], { timeout: 8000 });
      const matches = stdout.match(/^\s*\*/gm);
      return matches ? matches.length : 0;
    }
    if (os.platform() === "linux") {
      try {
        const { stdout } = await execFileP("/usr/lib/update-notifier/apt-check", [], { timeout: 5000 });
        // Output format: "<security>;<total>".
        const n = Number(stdout.trim().split(";")[0] ?? 0);
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    }
    // Windows update check is slow and gated by COM; skip for now.
    return 0;
  } catch {
    return 0;
  }
}

async function collect() {
  const [cpu, ram, disk, updates] = await Promise.all([
    Promise.resolve(cpuLoadPercent()),
    Promise.resolve(ramPercent()),
    diskPercent(),
    pendingUpdates(),
  ]);
  return {
    cpu, ram, disk,
    uptimeSeconds: Math.round(os.uptime()),
    pendingUpdates: updates,
    os: osLabel(),
  };
}

// ─── Check-in ────────────────────────────────────────────────────────

async function checkIn(cfg) {
  const metrics = await collect();
  const body = {
    hostname: cfg.hostname,
    os: metrics.os,
    cpu: metrics.cpu,
    ram: metrics.ram,
    disk: metrics.disk,
    uptimeSeconds: metrics.uptimeSeconds,
    pendingUpdates: metrics.pendingUpdates,
    agentVersion: VERSION,
    ...(cfg.assignedUser ? { assignedUser: cfg.assignedUser } : {}),
    ...(cfg.type ? { type: cfg.type } : {}),
  };

  const url = `${cfg.apiUrl.replace(/\/$/, "")}/api/agent/checkin`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
      "User-Agent": `relay-agent/${VERSION} (${os.platform()})`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`check-in failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ─── Phase 10C — pending-actions poll + execute + report ────────────

async function fetchPendingActions(cfg) {
  const url = `${cfg.apiUrl.replace(/\/$/, "")}/api/agent/actions?hostname=${encodeURIComponent(cfg.hostname)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`actions poll failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const { actions } = await resp.json();
  return actions ?? [];
}

async function reportActionResult(cfg, actionId, result) {
  const url = `${cfg.apiUrl.replace(/\/$/, "")}/api/agent/actions/${actionId}/result`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({
      ok: result.ok,
      output: result.output,
      data: result.data,
      errorMessage: result.errorMessage,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`action report failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

async function processActions(cfg) {
  const actions = await fetchPendingActions(cfg);
  for (const action of actions) {
    console.log(`▸ action ${action.id} ${action.kind} ${safeMode() ? "(SAFE)" : "(LIVE)"}`);
    let result;
    try {
      result = await executeAction(action.kind, action.input ?? {});
    } catch (err) {
      result = { ok: false, output: "", errorMessage: (err && err.message) || String(err) };
    }
    try {
      await reportActionResult(cfg, action.id, result);
      console.log(`   ↳ ${result.ok ? "✓" : "✗"} ${(result.output ?? "").split("\n")[0].slice(0, 100)}`);
    } catch (err) {
      console.error(`   ↳ report failed: ${(err && err.message) || err}`);
    }
  }
  return actions.length;
}

// ─── Main loop ───────────────────────────────────────────────────────

async function main() {
  const cfg = await resolveConfig();
  console.log(`relay-agent ${VERSION}  →  ${cfg.apiUrl}  every ${cfg.interval}s  host=${cfg.hostname}`);

  async function tick() {
    try {
      const result = await checkIn(cfg);
      console.log(`✓ ${new Date().toISOString()}  device=${result.hostname}  health=${result.healthStatus}`);
    } catch (err) {
      console.error(`✗ ${new Date().toISOString()}  ${(err && err.message) || err}`);
    }
    try {
      const n = await processActions(cfg);
      if (n > 0) console.log(`   actions handled: ${n}`);
    } catch (err) {
      console.error(`   actions poll error: ${(err && err.message) || err}`);
    }
  }

  await tick();
  if (cfg.once) return;

  setInterval(tick, cfg.interval * 1000);
}

main().catch((err) => {
  console.error("agent crashed:", err);
  process.exit(1);
});
