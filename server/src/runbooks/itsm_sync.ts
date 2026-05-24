/**
 * itsm_sync — LOW risk.
 *
 *   Match:   ticket text mentions "open in servicenow" / "push to jira"
 *            / "create incident in" etc.
 *   Execute: posts a snapshot to ServiceNow or Jira (whichever's configured
 *            first). External ref code is captured on decision.externalRef
 *            and posted as an internal note.
 *
 * Risk-wise this is just a write to an external ticketing system — no
 * infrastructure touched — so it can run auto. Still gated by policies
 * (no mass-action, etc.).
 */

import type { Runbook } from "./types.js";
import { basePrismaUnscoped } from "../db.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { pushToServiceNow, pushToJira } from "../integrations/itsm.js";

export const itsmSyncRunbook: Runbook = {
  key: "itsm_sync",
  name: "Push ticket to external ITSM",
  description: "Mirrors the ticket to ServiceNow or Jira (whichever the org has configured). LOW risk — runs without agent approval.",
  risk: "LOW",

  match({ ticket }) {
    const t = ticket.description.toLowerCase();
    if (/\b(open|create|push|sync)\s+(an?\s+)?(incident|ticket|issue)\s+(in|on|to)\s+(service\s?now|jira)\b/.test(t)) {
      return { confidence: 0.85, reason: "explicit ITSM sync request" };
    }
    if (/\b(service\s?now|jira)\b/.test(t) && /\b(open|create|push|sync|mirror)\b/.test(t)) {
      return { confidence: 0.6, reason: "ITSM brand + sync verb present" };
    }
    return { confidence: 0, reason: "no ITSM keyword" };
  },

  async execute({ ticket }) {
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: ticket.organizationId }, select: { settings: true },
    });
    const settings = parseOrgSettings(org?.settings);
    const itsm = settings.itsm;
    if (!itsm?.serviceNow && !itsm?.jira) {
      return {
        status: "FAILED",
        publicComment: "",
        internalNote: "[itsm_sync] no ITSM bridge configured (Organization.settings.itsm).",
        decision: { error: "no itsm config" },
      };
    }

    // Prefer Jira if both are configured AND the description mentions Jira;
    // otherwise default to ServiceNow if present, Jira if not.
    const wantJira = /\bjira\b/i.test(ticket.description) && itsm.jira;
    const target = wantJira ? "jira" : (itsm.serviceNow ? "service_now" : "jira");

    const result = target === "service_now" && itsm.serviceNow
      ? await pushToServiceNow({
          instance: itsm.serviceNow.instance,
          user:     itsm.serviceNow.user,
          table:    itsm.serviceNow.defaultTable,
          ticket: {
            refCode:        ticket.refCode,
            description:    ticket.description,
            category:       ticket.category,
            priority:       ticket.priority,
            submitterEmail: ticket.submitterEmail,
          },
        })
      : itsm.jira
        ? await pushToJira({
            baseUrl:   itsm.jira.baseUrl,
            project:   itsm.jira.project,
            user:      itsm.jira.user,
            issueType: itsm.jira.issueType,
            ticket: {
              refCode:     ticket.refCode,
              description: ticket.description,
              category:    ticket.category,
              priority:    ticket.priority,
            },
          })
        : { ok: false, statusCode: null, output: "no bridge configured", externalRef: null };

    return {
      status: result.ok ? "SUCCEEDED" : "FAILED",
      // ITSM sync doesn't close the Relay ticket — just records the mirror.
      closeTicket: false,
      publicComment: result.ok
        ? `Mirrored this ticket to ${target === "service_now" ? "ServiceNow" : "Jira"} as ${result.externalRef ?? "(no ref returned)"}.\n\n— Relay autopilot`
        : "",
      internalNote: result.ok
        ? `[itsm_sync] pushed to ${target} → external ref ${result.externalRef ?? "(none)"}`
        : `[itsm_sync] failed (HTTP ${result.statusCode}): ${result.output.slice(0, 300)}`,
      decision: {
        action: "itsm_sync", target,
        externalRef: result.externalRef,
        statusCode: result.statusCode,
      },
    };
  },
};
