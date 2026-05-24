/**
 * Phase 17 — Open Policy Agent (OPA) adapter.
 *
 * When `OPA_URL` is set, the policy engine forwards each `PolicyContext`
 * to OPA's data API and treats the response as ADDITIONAL guardrails on
 * top of the in-process TS policies in builtins.ts.
 *
 * Defense-in-depth semantics: OPA can only ADD denials, never reverse
 * a built-in DENY. If OPA is unreachable we treat that as ALLOW (fail-open)
 * with an internal log — so a Rego compile error or network outage cannot
 * grind the autopilot to a halt.
 *
 * Request body (POST `${OPA_URL}/v1/data/${OPA_DECISION_PATH}`):
 *   { "input": { ticket, runbook, risk, settings, recentRunbookCount, now } }
 *
 * Response shape we honour:
 *   { "result": true }                                  → ALLOW
 *   { "result": false }                                 → DENY (no reason)
 *   { "result": { "allow": true,  ... } }               → ALLOW
 *   { "result": { "allow": false, "reason": "...", "escalate": false } } → DENY
 *
 * Anything else (including HTTP failures) → fail-open ALLOW.
 */

import { env } from "../env.js";
import type { PolicyContext, PolicyVerdict } from "./types.js";

export function opaEnabled(): boolean {
  return Boolean(env.OPA_URL);
}

interface OpaResultObject {
  allow: boolean;
  reason?: string;
  escalate?: boolean;
}

function isAllowObject(x: unknown): x is OpaResultObject {
  return !!x && typeof x === "object" && "allow" in (x as Record<string, unknown>) && typeof (x as { allow: unknown }).allow === "boolean";
}

/**
 * Forward `ctx` to OPA and translate the response into a PolicyVerdict.
 * Returns ALLOW if OPA isn't configured or fails.
 */
export async function consultOpa(ctx: PolicyContext): Promise<PolicyVerdict> {
  const baseUrl = env.OPA_URL;
  if (!baseUrl) return { decision: "ALLOW" };

  const url = `${baseUrl.replace(/\/$/, "")}/v1/data/${env.OPA_DECISION_PATH}`;
  // Strip non-JSON-serialisable bits and trim the ticket to keep the
  // payload small — OPA shouldn't need the full row.
  const input = {
    ticket: {
      id: ctx.ticket.id, refCode: ctx.ticket.refCode,
      category: ctx.ticket.category, priority: ctx.ticket.priority,
      submitterEmail: ctx.ticket.submitterEmail,
    },
    runbook: { key: ctx.runbook.key, risk: ctx.runbook.risk },
    risk: ctx.risk,
    settings: ctx.settings,
    recentRunbookCount: ctx.recentRunbookCount,
    now: ctx.now.toISOString(),
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    if (!resp.ok) {
      console.warn(`[opa] non-OK ${resp.status} — fail-open ALLOW`);
      return { decision: "ALLOW" };
    }
    const json = (await resp.json()) as { result?: unknown };
    const result = json.result;
    if (result === undefined) return { decision: "ALLOW" }; // undefined = no rule matched = allow

    if (typeof result === "boolean") {
      return result ? { decision: "ALLOW" } : { decision: "DENY", reason: "opa: denied", escalate: false };
    }
    if (isAllowObject(result)) {
      if (result.allow) return { decision: "ALLOW" };
      return {
        decision: "DENY",
        reason: `opa: ${result.reason ?? "denied"}`,
        escalate: result.escalate === true,
      };
    }
    return { decision: "ALLOW" }; // unknown shape → fail-open
  } catch (err) {
    console.warn("[opa] consult failed (fail-open):", (err as Error).message);
    return { decision: "ALLOW" };
  }
}
