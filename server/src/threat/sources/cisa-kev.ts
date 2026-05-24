/**
 * Phase 25 — CISA KEV (Known Exploited Vulnerabilities) ingester.
 *
 * CISA publishes the canonical "exploited in the wild" CVE catalog as a
 * single JSON file refreshed continuously:
 *   https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 *
 * Each entry includes the CVE id, vendor + product, vulnerability name,
 * shortDescription, requiredAction, dueDate, dateAdded, and the
 * knownRansomwareCampaignUse flag. We map those to ThreatIntel(kind=KEV).
 *
 * KEV entries automatically get severity=CRITICAL since CISA only
 * publishes CVEs known to be actively exploited.
 */

import { env } from "../../env.js";
import { clampDescription, type IngestedIntel, type IngesterSource } from "../types.js";

interface KevVulnerability {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string; // "Known" | "Unknown"
  notes: string;
  cwes?: string[];
}

interface KevCatalog {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: KevVulnerability[];
}

export const cisaKevSource: IngesterSource = {
  id: "cisa_kev",
  name: "CISA Known Exploited Vulnerabilities",
  async fetch(): Promise<IngestedIntel[]> {
    const resp = await fetch(env.CISA_KEV_URL, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`CISA KEV HTTP ${resp.status}`);
    }
    const catalog = (await resp.json()) as KevCatalog;
    if (!Array.isArray(catalog.vulnerabilities)) return [];

    return catalog.vulnerabilities.map((v) => {
      const ransomware = (v.knownRansomwareCampaignUse ?? "").toLowerCase() === "known";
      return {
        kind: "KEV" as const,
        externalId: v.cveID,
        title: `${v.cveID} — ${v.vendorProject} ${v.product}: ${v.vulnerabilityName}`.slice(0, 280),
        description: clampDescription(
          `${v.shortDescription}\n\nRequired action: ${v.requiredAction}\n` +
          `Date added to KEV: ${v.dateAdded}\nDue date: ${v.dueDate}\n` +
          (ransomware ? "⚠ Known ransomware-campaign use" : ""),
        ),
        // CISA only lists actively-exploited CVEs — always CRITICAL.
        severity: "CRITICAL",
        cvss: undefined,
        references: [
          `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
          `https://www.cisa.gov/known-exploited-vulnerabilities-catalog`,
        ],
        affected: [v.vendorProject, v.product, v.vulnerabilityName]
          .map((s) => (s ?? "").trim()).filter(Boolean),
        kevMetadata: {
          knownRansomwareCampaignUse: ransomware,
          requiredAction: v.requiredAction,
          dueDate: v.dueDate || null,
        },
        publishedAt: parseDate(v.dateAdded) ?? new Date(),
      };
    });
  },
};

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
