/**
 * Phase 25 — GitHub Security Advisories (GHSA) ingester.
 *
 * GHSA is GitHub's curated CVE-like database. We use the REST endpoint:
 *   GET https://api.github.com/advisories?per_page=100&sort=published&direction=desc
 *
 * Auth: optional but rate-limited differently. Uses the existing
 * GITHUB_TOKEN when present (60 req/h anonymous → 5000 req/h authed).
 *
 * Spec: https://docs.github.com/en/rest/security-advisories/global-advisories
 */

import { env } from "../../env.js";
import { clampDescription, severityFromCvss, type IngestedIntel, type IngesterSource } from "../types.js";

interface GhsaResponse {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  cvss?: { score?: number; vector_string?: string };
  identifiers?: Array<{ type: string; value: string }>;
  references?: Array<{ url: string }>;
  published_at: string;
  vulnerabilities?: Array<{
    package?: { ecosystem?: string; name?: string };
    vulnerable_version_range?: string;
  }>;
}

export const ghsaSource: IngesterSource = {
  id: "ghsa",
  name: "GitHub Security Advisories",
  async fetch(): Promise<IngestedIntel[]> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

    const url = new URL("https://api.github.com/advisories");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("sort", "published");
    url.searchParams.set("direction", "desc");

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      throw new Error(`GHSA HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
    }
    const items = (await resp.json()) as GhsaResponse[];
    if (!Array.isArray(items)) return [];

    return items.map((g) => {
      const sev = ((g.severity ?? "medium").toUpperCase()) as IngestedIntel["severity"];
      const cvss = g.cvss?.score ?? undefined;
      const affected = (g.vulnerabilities ?? [])
        .map((v) => {
          const eco = v.package?.ecosystem ?? "";
          const name = v.package?.name ?? "";
          return [eco, name].filter(Boolean).join(":");
        })
        .filter(Boolean);
      return {
        kind: "ADVISORY",
        externalId: g.ghsa_id,
        title: `${g.ghsa_id}${g.cve_id ? ` / ${g.cve_id}` : ""} — ${g.summary}`.slice(0, 280),
        description: clampDescription(g.description ?? g.summary),
        severity: (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).includes(sev as never) ? sev : severityFromCvss(cvss),
        cvss,
        references: (g.references ?? [])
          .map((r) => r.url)
          .filter((u): u is string => typeof u === "string" && u.length > 0)
          .slice(0, 10),
        affected,
        publishedAt: new Date(g.published_at),
      };
    });
  },
};
