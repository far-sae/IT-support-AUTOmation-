/**
 * Phase 25 — NVD (National Vulnerability Database) ingester.
 *
 * Pulls CVEs published in the last `NVD_LOOKBACK_DAYS` window via
 * https://services.nvd.nist.gov/rest/json/cves/2.0
 *
 * Without an API key NVD allows 5 requests / 30s public. With NVD_API_KEY
 * set we get 50 requests / 30s. Either way we fetch in chunks of 2000
 * results (NVD's max page size) and respect the documented pagination.
 *
 * Severity comes from the CVSS v3 base score where available, else falls
 * back to MEDIUM.
 */

import { env } from "../../env.js";
import { clampDescription, severityFromCvss, type IngestedIntel, type IngesterSource } from "../types.js";

interface NvdResponse {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  vulnerabilities: Array<{
    cve: {
      id: string;
      sourceIdentifier?: string;
      published: string;
      lastModified: string;
      vulnStatus?: string;
      descriptions: Array<{ lang: string; value: string }>;
      metrics?: {
        cvssMetricV31?: Array<{ cvssData?: { baseScore?: number; vectorString?: string } }>;
        cvssMetricV30?: Array<{ cvssData?: { baseScore?: number; vectorString?: string } }>;
        cvssMetricV2?:  Array<{ cvssData?: { baseScore?: number; vectorString?: string } }>;
      };
      configurations?: Array<{
        nodes?: Array<{ cpeMatch?: Array<{ criteria?: string; vulnerable?: boolean }> }>;
      }>;
      references?: Array<{ url: string; source?: string }>;
    };
  }>;
}

const PAGE_SIZE = 2000;

export const nvdSource: IngesterSource = {
  id: "nvd",
  name: "NVD recent CVEs",
  async fetch(): Promise<IngestedIntel[]> {
    const since = new Date(Date.now() - env.NVD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const isoSince = since.toISOString();
    const isoNow   = new Date().toISOString();

    const headers: Record<string, string> = { Accept: "application/json" };
    if (env.NVD_API_KEY) headers.apiKey = env.NVD_API_KEY;

    const all: IngestedIntel[] = [];
    let startIndex = 0;
    let total = Infinity;

    while (startIndex < total) {
      const url = new URL(`${env.NVD_API_BASE}/cves/2.0`);
      url.searchParams.set("pubStartDate", isoSince);
      url.searchParams.set("pubEndDate",   isoNow);
      url.searchParams.set("resultsPerPage", String(PAGE_SIZE));
      url.searchParams.set("startIndex",     String(startIndex));

      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        throw new Error(`NVD HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
      }
      const body = (await resp.json()) as NvdResponse;
      total = body.totalResults;
      for (const item of body.vulnerabilities ?? []) {
        const c = item.cve;
        const cvss = pickCvss(c.metrics);
        const desc = c.descriptions?.find((d) => d.lang === "en")?.value ?? "";
        const affected = extractAffected(c);
        all.push({
          kind: "CVE",
          externalId: c.id,
          title: `${c.id} — ${affected.slice(0, 3).join(", ")}`.slice(0, 280),
          description: clampDescription(desc),
          severity: severityFromCvss(cvss),
          cvss,
          references: (c.references ?? []).map((r) => r.url).slice(0, 10),
          affected,
          publishedAt: parseDate(c.published) ?? new Date(),
        });
      }
      if (body.vulnerabilities.length === 0) break;
      startIndex += body.vulnerabilities.length;
      // NVD requests inter-call delay even when not capped — be polite.
      await new Promise((r) => setTimeout(r, env.NVD_API_KEY ? 600 : 6000));
    }
    return all;
  },
};

function pickCvss(metrics: NvdResponse["vulnerabilities"][number]["cve"]["metrics"]): number | undefined {
  return (
    metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore ??
    metrics?.cvssMetricV30?.[0]?.cvssData?.baseScore ??
    metrics?.cvssMetricV2?.[0]?.cvssData?.baseScore
  );
}

function extractAffected(cve: NvdResponse["vulnerabilities"][number]["cve"]): string[] {
  const out: string[] = [];
  for (const cfg of cve.configurations ?? []) {
    for (const node of cfg.nodes ?? []) {
      for (const m of node.cpeMatch ?? []) {
        if (m.vulnerable && m.criteria) out.push(m.criteria);
      }
    }
  }
  return [...new Set(out)].slice(0, 20);
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
