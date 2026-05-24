/**
 * Phase 14 — Firewall adapter.
 *
 * Vendor-neutral interface for adding an IP to a block-list. Three vendors
 * shipped today; "generic" is a pass-through to any REST endpoint that
 * accepts `{ ip, action }` on POST.
 *
 *   • palo_alto — PAN-OS via the EDL (External Dynamic List) update API.
 *     The block-list is the EDL name.
 *   • pfsense   — pfSense via the `pfblockerng` alias REST endpoint.
 *   • generic   — POST to `${baseUrl}/block` with `{ ip, action: "BLOCK" }`.
 *
 * Token comes from `env.FIREWALL_API_TOKEN` (per-org overrides would need
 * a secrets vault — out of scope here).
 *
 * Failure is non-throwing: returns `{ ok: false, output: "..." }` so the
 * caller can record the audit trail.
 */

import { env } from "../env.js";

export type FirewallVendor = "palo_alto" | "pfsense" | "generic";

export interface FirewallBlockArgs {
  vendor: FirewallVendor;
  baseUrl: string;
  blockList?: string;
  ip: string;
  /** Default action — "BLOCK". Pass "UNBLOCK" to remove. */
  action?: "BLOCK" | "UNBLOCK";
}

export interface FirewallResult {
  ok: boolean;
  statusCode: number | null;
  output: string;
}

export async function pushFirewallBlock(args: FirewallBlockArgs): Promise<FirewallResult> {
  const token = env.FIREWALL_API_TOKEN;
  if (!token) {
    return { ok: false, statusCode: null, output: "FIREWALL_API_TOKEN not set" };
  }
  const action = args.action ?? "BLOCK";
  try {
    let url: string;
    let body: string;
    if (args.vendor === "palo_alto") {
      const list = args.blockList ?? "relay-block";
      url = `${args.baseUrl}/api/?type=op&cmd=<request><system><external-list><refresh><name>${encodeURIComponent(list)}</name></refresh></external-list></system></request>&key=${encodeURIComponent(token)}`;
      body = JSON.stringify({ ip: args.ip, action });
    } else if (args.vendor === "pfsense") {
      url = `${args.baseUrl}/api/v1/firewall/alias/entry`;
      body = JSON.stringify({
        name: args.blockList ?? "relay_block",
        address: args.ip,
        // pfSense's REST plug-in interprets `enabled: false` as removal.
        enabled: action === "BLOCK",
      });
    } else {
      url = `${args.baseUrl.replace(/\/$/, "")}/block`;
      body = JSON.stringify({ ip: args.ip, action });
    }
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
    });
    const text = await resp.text().catch(() => "");
    return { ok: resp.ok, statusCode: resp.status, output: text.slice(0, 2000) };
  } catch (err) {
    return { ok: false, statusCode: null, output: `Network error: ${(err as Error).message}` };
  }
}
