/**
 * Phase 26 — Mandiant (Google Cloud Threat Intelligence) — API v4 adapter.
 *
 * Auth flow:
 *   POST {MANDIANT_API_BASE}/token
 *     Authorization: Basic base64(KEY:SECRET)
 *     Content-Type: application/x-www-form-urlencoded
 *     body: grant_type=client_credentials&scope=...
 *   200 → { access_token, token_type, expires_in }
 *
 * Tokens are good for ~30 min — we cache in-process + refresh on 401.
 *
 * Data we ingest:
 *   GET /v4/vulnerability?start_epoch=...&end_epoch=...&limit=100&gte_mscore=70
 *
 * Reference shape (trimmed to fields we use):
 *   {
 *     vulnerabilities: [{
 *       id, cve_id, title, description, published_date, last_modified_date,
 *       common_vulnerability_scores: { v3.1: { base_score } },
 *       analysis: { exploitation_state, exploitation_consequence, vendor_fix_references: [...] },
 *       affected_vendors_products: [{ vendor, product, versions }],
 *       associations: { malware_families: [...], actors: [...] },
 *       mscore
 *     }],
 *     total_count, offset, limit
 *   }
 */

import { env } from "../../env.js";
import { clampDescription, severityFromCvss, type IngestedIntel, type IngesterSource } from "../types.js";

interface MandiantTokenResponse {
  access_token: string;
  token_type:   string;
  expires_in:   number;
}

interface MandiantVuln {
  id?: string;
  cve_id?: string;
  title?: string;
  description?: string;
  published_date?: string;
  last_modified_date?: string;
  common_vulnerability_scores?: { "v3.1"?: { base_score?: number } };
  analysis?: {
    exploitation_state?: string;
    exploitation_consequence?: string;
    vendor_fix_references?: Array<{ url?: string }>;
  };
  affected_vendors_products?: Array<{ vendor?: string; product?: string }>;
  associations?: {
    malware_families?: Array<{ name?: string }>;
    actors?: Array<{ name?: string }>;
  };
  mscore?: number;
  vendor_references?: Array<{ url?: string }>;
}

interface MandiantVulnResponse {
  vulnerabilities?: MandiantVuln[];
  total_count?: number;
  offset?: number;
  limit?: number;
}

// ─── Token cache ─────────────────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  if (!env.MANDIANT_API_KEY || !env.MANDIANT_API_SECRET) {
    throw new Error("MANDIANT_API_KEY / MANDIANT_API_SECRET not set");
  }
  const auth = Buffer.from(`${env.MANDIANT_API_KEY}:${env.MANDIANT_API_SECRET}`).toString("base64");
  const resp = await fetch(`${env.MANDIANT_API_BASE.replace(/\/$/, "")}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Mandiant token ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as MandiantTokenResponse;
  cachedToken = {
    token: json.access_token,
    expiresAt: now + Math.max(60_000, (json.expires_in ?? 1800) * 1000),
  };
  return cachedToken.token;
}

/** Test/debug helper — drops the cached token so the next fetch re-auths. */
export function _resetMandiantTokenCache(): void {
  cachedToken = null;
}

// ─── Source ──────────────────────────────────────────────────────────

export const mandiantSource: IngesterSource = {
  id: "mandiant",
  name: "Mandiant (Google Cloud Threat Intelligence)",
  async fetch(): Promise<IngestedIntel[]> {
    if (!env.MANDIANT_API_KEY || !env.MANDIANT_API_SECRET) return [];

    const token = await getToken();
    // 24 h window is the smallest useful sweep — the cron polls 30 min,
    // so consecutive runs heavily overlap, and dedup catches the rest.
    const endEpoch   = Math.floor(Date.now() / 1000);
    const startEpoch = endEpoch - 24 * 60 * 60;
    const url = new URL(`${env.MANDIANT_API_BASE.replace(/\/$/, "")}/v4/vulnerability`);
    url.searchParams.set("start_epoch",  String(startEpoch));
    url.searchParams.set("end_epoch",    String(endEpoch));
    url.searchParams.set("limit",        "100");
    url.searchParams.set("gte_mscore",   String(env.MANDIANT_MIN_MSCORE));

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-App-Name":  "relay-server",
        Accept:        "application/json",
      },
    });
    if (resp.status === 401) {
      // Token expired mid-flight; one retry with a fresh token.
      _resetMandiantTokenCache();
      return mandiantSource.fetch();
    }
    if (!resp.ok) {
      throw new Error(`Mandiant /v4/vulnerability ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    }
    const body = (await resp.json()) as MandiantVulnResponse;
    if (!Array.isArray(body.vulnerabilities)) return [];

    return body.vulnerabilities.map((v) => {
      const cvss = v.common_vulnerability_scores?.["v3.1"]?.base_score;
      const baseSeverity = severityFromCvss(cvss);
      // Promote when Mandiant has confirmed exploitation. Their state strings:
      // "Available", "Anticipated", "Confirmed", "Wide".
      const exploit = (v.analysis?.exploitation_state ?? "").toLowerCase();
      const severity = exploit === "wide" || exploit === "confirmed"
        ? "CRITICAL" as const
        : baseSeverity;

      const affectedProducts = (v.affected_vendors_products ?? [])
        .flatMap((p) => [p.vendor, p.product])
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      const malware = v.associations?.malware_families?.map((m) => m.name).filter(Boolean) ?? [];
      const actors  = v.associations?.actors?.map((a) => a.name).filter(Boolean) ?? [];

      const desc = [
        v.description ?? "",
        v.analysis?.exploitation_state    ? `\nExploitation state: ${v.analysis.exploitation_state}` : "",
        v.analysis?.exploitation_consequence ? `\nConsequence: ${v.analysis.exploitation_consequence}` : "",
        malware.length > 0 ? `\nLinked malware: ${malware.join(", ")}` : "",
        actors.length > 0  ? `\nLinked actors: ${actors.join(", ")}`   : "",
        v.mscore != null   ? `\nMandiant mscore: ${v.mscore}` : "",
      ].join("");

      const refs = [
        ...(v.analysis?.vendor_fix_references ?? []),
        ...(v.vendor_references ?? []),
      ].map((r) => r.url).filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, 10);

      return {
        kind: "CVE" as const,
        externalId: (v.cve_id ?? v.id ?? "").trim(),
        title: `${v.cve_id ?? v.id} — ${v.title ?? ""}`.slice(0, 280),
        description: clampDescription(desc.trim()),
        severity,
        cvss,
        references: refs,
        affected: [...new Set(affectedProducts)].slice(0, 20),
        publishedAt: parseDate(v.published_date) ?? new Date(),
      };
    }).filter((i) => i.externalId.length > 0);
  },
};

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
