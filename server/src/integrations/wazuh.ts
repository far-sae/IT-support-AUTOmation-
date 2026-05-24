/**
 * Phase 27 — Wazuh REST API adapter.
 *
 * Wazuh exposes a manager-side REST API on port 55000 by default. To poll
 * alerts we:
 *   1. POST /security/user/authenticate with HTTP Basic → returns a JWT
 *   2. GET /alerts?limit=... with `Authorization: Bearer <jwt>`
 *
 * The JWT is good for 15 min by default; we cache + refresh on 401.
 *
 * Note: the OpenSearch-backed alerts endpoint that ships with the Wazuh
 * indexer is the more common ingest path in production. This adapter
 * targets the manager API for simplicity + because it's universally
 * available. Production deployments at scale would switch to the indexer
 * endpoint with the same shape.
 *
 * Reference: https://documentation.wazuh.com/current/user-manual/api/
 */

import { env } from "../env.js";

interface WazuhTokenResponse {
  data?: { token?: string };
  error?: number; message?: string;
}

interface WazuhAlertsResponse {
  data?: {
    affected_items?: WazuhAlert[];
    total_affected_items?: number;
    failed_items?: Array<unknown>;
    total_failed_items?: number;
  };
  message?: string;
  error?: number;
}

export interface WazuhAlert {
  id?:     string;
  // Wazuh's alert shape — top-level metadata + a nested `rule` block.
  timestamp?: string;
  agent?: { id?: string; name?: string; ip?: string };
  rule?: {
    id?: number | string;
    level?: number;
    description?: string;
    mitre?: { id?: string[]; tactic?: string[]; technique?: string[] };
  };
  data?: { srcip?: string; dstip?: string };
  full_log?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export function _resetWazuhToken(): void { cachedToken = null; }

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  if (!env.WAZUH_API_URL || !env.WAZUH_API_USER || !env.WAZUH_API_PASSWORD) {
    throw new Error("WAZUH_API_URL / WAZUH_API_USER / WAZUH_API_PASSWORD not set");
  }
  const auth = Buffer.from(`${env.WAZUH_API_USER}:${env.WAZUH_API_PASSWORD}`).toString("base64");
  const resp = await fetch(`${env.WAZUH_API_URL.replace(/\/$/, "")}/security/user/authenticate`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Wazuh /security/user/authenticate ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  }
  const json = (await resp.json()) as WazuhTokenResponse;
  const token = json.data?.token;
  if (!token) throw new Error("Wazuh did not return a token");
  // Default Wazuh token TTL = 900 s. Refresh 60 s before expiry.
  cachedToken = { token, expiresAt: now + 14 * 60 * 1000 };
  return token;
}

/**
 * Fetch the most recent alerts. Wazuh's manager API returns them in
 * descending timestamp order; we ask for `limit` and dedupe upstream.
 */
export async function fetchWazuhAlerts(limit: number = 100): Promise<WazuhAlert[]> {
  if (!env.WAZUH_API_URL) return [];

  const token = await getToken();
  const url = new URL(`${env.WAZUH_API_URL.replace(/\/$/, "")}/alerts`);
  url.searchParams.set("limit",  String(Math.min(500, limit)));
  url.searchParams.set("sort",   "-timestamp");

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (resp.status === 401) {
    _resetWazuhToken();
    return fetchWazuhAlerts(limit);
  }
  if (!resp.ok) {
    throw new Error(`Wazuh /alerts ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  }
  const body = (await resp.json()) as WazuhAlertsResponse;
  return body.data?.affected_items ?? [];
}
