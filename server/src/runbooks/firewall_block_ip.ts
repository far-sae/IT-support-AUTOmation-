/**
 * firewall_block_ip — HIGH risk.
 *
 *   Match:   ticket text mentions "block IP" / "block traffic from" and
 *            contains an IPv4 address. The IP is extracted from the
 *            description.
 *   Execute: hits the configured firewall vendor API to add the IP to
 *            the block-list.
 */

import type { Runbook } from "./types.js";
import { basePrismaUnscoped } from "../db.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { pushFirewallBlock } from "../integrations/firewall.js";

const IPV4 = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})\b/;

export const firewallBlockIpRunbook: Runbook = {
  key: "firewall_block_ip",
  name: "Block an IP at the firewall",
  description: "Adds an attacker IP to the org's configured block-list (PaloAlto / pfSense / generic). HIGH risk — requires admin approval.",
  risk: "HIGH",

  match({ ticket }) {
    const t = ticket.description.toLowerCase();
    const opsHit = /\b(block|deny|null[-\s]?route|sinkhole|quarantine)\b.{0,40}\b(ip|address|host|traffic)\b/.test(t);
    if (!opsHit) return { confidence: 0, reason: "no block-ip keyword" };
    if (!IPV4.test(ticket.description)) return { confidence: 0.2, reason: "block phrase but no IPv4 found" };
    return { confidence: 0.85, reason: "block-ip keyword + IPv4 present" };
  },

  async execute({ ticket }) {
    const ipMatch = ticket.description.match(IPV4);
    if (!ipMatch) {
      return {
        status: "FAILED",
        publicComment: "",
        internalNote: "[firewall_block_ip] could not extract an IP address from the ticket.",
        decision: { error: "no ip found" },
      };
    }
    const ip = ipMatch[1]!;

    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: ticket.organizationId }, select: { settings: true },
    });
    const settings = parseOrgSettings(org?.settings);
    if (!settings.firewall) {
      return {
        status: "FAILED",
        publicComment: "",
        internalNote: "[firewall_block_ip] no firewall configured (Organization.settings.firewall).",
        decision: { error: "no firewall config" },
      };
    }

    const result = await pushFirewallBlock({
      vendor: settings.firewall.vendor,
      baseUrl: settings.firewall.baseUrl,
      blockList: settings.firewall.blockList,
      ip,
      action: "BLOCK",
    });
    return {
      status: result.ok ? "SUCCEEDED" : "FAILED",
      closeTicket: result.ok,
      publicComment: result.ok
        ? `Done — ${ip} is now blocked at the firewall (${settings.firewall.vendor}). Closing this ticket.\n\n— Relay autopilot`
        : "",
      internalNote: result.ok
        ? `[firewall_block_ip] ${ip} added to ${settings.firewall.blockList ?? "default block-list"} on ${settings.firewall.vendor}`
        : `[firewall_block_ip] failed (HTTP ${result.statusCode}): ${result.output.slice(0, 300)}`,
      decision: {
        action: "firewall_block_ip",
        vendor: settings.firewall.vendor,
        ip, statusCode: result.statusCode,
      },
    };
  },
};
