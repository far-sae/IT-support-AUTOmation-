/**
 * Phase 26 — CrowdStrike Falcon Intelligence adapter.
 *
 * Auth (OAuth2 client_credentials):
 *   POST {base}/oauth2/token
 *     Content-Type: application/x-www-form-urlencoded
 *     body: client_id=...&client_secret=...
 *   200 → { access_token, expires_in, token_type }
 *
 * Tokens last ~30 min. We cache in-process + refresh on 401.
 *
 * Data:
 *   GET {base}/intel/combined/vulnerabilities/v1?filter=...&sort=created_timestamp.desc&limit=100
 *
 * Response shape (trimmed):
 *   {
 *     meta: { ... },
 *     resources: [{
 *       cve: { id, description, severity, base_score, references: [...] },
 *       vendor: { name }, product: { name },
 *       actors: [{ name }], adversaries: [{ name }],
 *       published_date, exploit_status, exploited_in_wild: bool, ...
 *     }],
 *     errors: []
 *   }
 */

import { env } from "../../env.js";
import { clampDescription, severityFromCvss, type IngestedIntel, type IngesterSource } from "../types.js";

interface CsTokenResponse {
  access_token: string;
  expires_in:   number;
  token_type:   string;
}

interface CsVuln {
  cve?: {
    id?: string;
    description?: string;
    severity?: string;
    base_score?: number;
    references?: Array<{ url?: string }>;
  };
  vendor?:  { name?: string };
  product?: { name?: string };
  actors?:      Array<{ name?: string }>;
  adversaries?: Array<{ name?: string }>;
  published_date?:    string;
  exploit_status?:    string;
  exploited_in_wild?: boolean;
}

interface CsResponse {
  meta?: { pagination?: { total?: number; offset?: number; limit?: number } };
  resources?: CsVuln[];
  errors?: Array<{ message?: string }>;
}

// ─── Token cache ─────────────────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  if (!env.CROWDSTRIKE_CLIENT_ID || !env.CROWDSTRIKE_CLIENT_SECRET) {
    throw new Error("CROWDSTRIKE_CLIENT_ID / CROWDSTRIKE_CLIENT_SECRET not set");
  }
  const body = new URLSearchParams({
    client_id:     env.CROWDSTRIKE_CLIENT_ID,
    client_secret: env.CROWDSTRIKE_CLIENT_SECRET,
  });
  const resp = await fetch(`${env.CROWDSTRIKE_API_BASE.replace(/\/$/, "")}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`CrowdStrike /oauth2/token ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as CsTokenResponse;
  cachedToken = {
    token: json.access_token,
    expiresAt: now + Math.max(60_000, (json.expires_in ?? 1800) * 1000),
  };
  return cachedToken.token;
}

export function _resetCrowdstrikeTokenCache(): void {
  cachedToken = null;
}

export const crowdstrikeSource: IngesterSource = {
  id: "crowdstrike",
  name: "CrowdStrike Falcon Intelligence",
  async fetch(): Promise<IngestedIntel[]> {
    if (!env.CROWDSTRIKE_CLIENT_ID || !env.CROWDSTRIKE_CLIENT_SECRET) return [];

    const token = await getToken();
    const cutoffEpoch = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    // Falcon's FQL ("Falcon Query Language") filter syntax.
    const filter = `published_date:>${cutoffEpoch}`;

    const url = new URL(`${env.CROWDSTRIKE_API_BASE.replace(/\/$/, "")}/intel/combined/vulnerabilities/v1`);
    url.searchParams.set("filter", filter);
    url.searchParams.set("sort", "published_date.desc");
    url.searchParams.set("limit", "100");

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (resp.status === 401) {
      _resetCrowdstrikeTokenCache();
      return crowdstrikeSource.fetch();
    }
    if (!resp.ok) {
      throw new Error(`CrowdStrike /intel/combined/vulnerabilities ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    }
    const body = (await resp.json()) as CsResponse;
    const resources = body.resources ?? [];

    return resources.map((v) => {
      const cveId = v.cve?.id ?? "";
      const cvss  = v.cve?.base_score;
      const baseSeverity = severityFromCvss(cvss);
      const severity = v.exploited_in_wild ? "CRITICAL" as const : baseSeverity;

      const actors = [...(v.actors ?? []), ...(v.adversaries ?? [])]
        .map((a) => a.name).filter(Boolean) as string[];

      const desc = [
        v.cve?.description ?? "",
        v.exploit_status    ? `\nExploit status: ${v.exploit_status}` : "",
        v.exploited_in_wild ? `\n⚠ Exploited in the wild`              : "",
        actors.length > 0   ? `\nLinked actors: ${actors.join(", ")}`  : "",
      ].join("");

      const affected = [v.vendor?.name, v.product?.name]
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      const refs = (v.cve?.references ?? [])
        .map((r) => r.url)
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .slice(0, 10);

      return {
        kind: "CVE" as const,
        externalId: cveId.trim(),
        title: `${cveId} — ${affected.join(" ")}`.slice(0, 280),
        description: clampDescription(desc.trim()),
        severity,
        cvss,
        references: refs,
        affected,
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
