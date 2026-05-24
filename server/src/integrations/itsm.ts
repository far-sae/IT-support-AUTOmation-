/**
 * Phase 14 — ITSM bridges (ServiceNow + Jira).
 *
 * Outbound-only: Relay pushes a snapshot of a ticket to the external system
 * when an admin asks. Bringing changes BACK from those systems would require
 * polling + a webhook — left as future work.
 *
 * ServiceNow: POST /api/now/table/{table}; basic auth user + token from env.
 * Jira: POST /rest/api/3/issue; basic auth (email + token from env).
 */

import { env } from "../env.js";

export interface ItsmPushResult {
  ok: boolean;
  statusCode: number | null;
  output: string;
  externalRef: string | null; // e.g. "INC0010012" (ServiceNow) or "OPS-42" (Jira)
}

// ─── ServiceNow ──────────────────────────────────────────────────────

export interface ServiceNowPushArgs {
  instance: string;   // "https://acme.service-now.com"
  user: string;
  table?: string;     // default "incident"
  ticket: {
    refCode: string;
    description: string;
    category: string;
    priority: string;
    submitterEmail: string;
  };
}

export async function pushToServiceNow(args: ServiceNowPushArgs): Promise<ItsmPushResult> {
  const token = env.SERVICENOW_API_TOKEN;
  if (!token) return { ok: false, statusCode: null, output: "SERVICENOW_API_TOKEN not set", externalRef: null };
  const table = args.table ?? "incident";
  const url = `${args.instance.replace(/\/$/, "")}/api/now/table/${encodeURIComponent(table)}`;
  const auth = Buffer.from(`${args.user}:${token}`).toString("base64");
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept:         "application/json",
        Authorization:  `Basic ${auth}`,
      },
      body: JSON.stringify({
        short_description: `[Relay ${args.ticket.refCode}] ${args.ticket.category}`,
        description:       args.ticket.description,
        urgency:           snowUrgency(args.ticket.priority),
        caller_id:         args.ticket.submitterEmail,
        external_id:       args.ticket.refCode,
      }),
    });
    const text = await resp.text().catch(() => "");
    let externalRef: string | null = null;
    try {
      const parsed = JSON.parse(text) as { result?: { number?: string } };
      externalRef = parsed.result?.number ?? null;
    } catch { /* leave null */ }
    return { ok: resp.ok, statusCode: resp.status, output: text.slice(0, 2000), externalRef };
  } catch (err) {
    return { ok: false, statusCode: null, output: `Network error: ${(err as Error).message}`, externalRef: null };
  }
}

function snowUrgency(priority: string): string {
  switch (priority) {
    case "Critical": return "1";
    case "High":     return "2";
    case "Medium":   return "3";
    default:         return "3";
  }
}

// ─── Jira ────────────────────────────────────────────────────────────

export interface JiraPushArgs {
  baseUrl: string;
  project: string;
  user: string;
  issueType?: string; // default "Task"
  ticket: {
    refCode: string;
    description: string;
    category: string;
    priority: string;
  };
}

export async function pushToJira(args: JiraPushArgs): Promise<ItsmPushResult> {
  const token = env.JIRA_API_TOKEN;
  if (!token) return { ok: false, statusCode: null, output: "JIRA_API_TOKEN not set", externalRef: null };
  const url = `${args.baseUrl.replace(/\/$/, "")}/rest/api/3/issue`;
  const auth = Buffer.from(`${args.user}:${token}`).toString("base64");
  const issueType = args.issueType ?? "Task";
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept:         "application/json",
        Authorization:  `Basic ${auth}`,
      },
      body: JSON.stringify({
        fields: {
          project:     { key: args.project },
          issuetype:   { name: issueType },
          summary:     `[Relay ${args.ticket.refCode}] ${args.ticket.category}`,
          description: {
            type:    "doc", version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: args.ticket.description }] }],
          },
          labels: ["relay", args.ticket.priority.toLowerCase()],
        },
      }),
    });
    const text = await resp.text().catch(() => "");
    let externalRef: string | null = null;
    try {
      const parsed = JSON.parse(text) as { key?: string };
      externalRef = parsed.key ?? null;
    } catch { /* leave null */ }
    return { ok: resp.ok, statusCode: resp.status, output: text.slice(0, 2000), externalRef };
  } catch (err) {
    return { ok: false, statusCode: null, output: `Network error: ${(err as Error).message}`, externalRef: null };
  }
}
