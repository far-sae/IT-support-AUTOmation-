/**
 * Phase 25 — Threat-intel ingester types.
 *
 * Every external source (CISA KEV, NVD, GHSA, RSS feeds) implements
 * `IngesterSource`. The engine calls `fetch()` on each enabled source,
 * deduplicates by (source, externalId), and persists new items as
 * `ThreatIntel` rows.
 */

export interface IngestedIntel {
  /** Stable kind from the schema enum. */
  kind: "CVE" | "KEV" | "IOC_IP" | "IOC_DOMAIN" | "IOC_HASH" | "NEWS" | "ADVISORY";
  /** Stable external id (CVE-2024-XXXXX, GHSA-..., NVD record id, URL hash). */
  externalId: string;
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  cvss?: number;
  references: string[];
  /** Vendor / product / CPE / keyword strings for asset matching. */
  affected: string[];
  /** Optional KEV-specific metadata. */
  kevMetadata?: {
    knownRansomwareCampaignUse?: boolean;
    requiredAction?: string;
    dueDate?: string | null;
  };
  publishedAt: Date;
}

export interface IngesterSource {
  /** Stable id used in ThreatIntel.source (e.g. "cisa_kev"). */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Pull the latest batch. Idempotent — engine handles dedup. */
  fetch: () => Promise<IngestedIntel[]>;
}

/**
 * Best-effort CVSS severity mapping.
 * Spec: https://nvd.nist.gov/vuln-metrics/cvss
 */
export function severityFromCvss(score: number | undefined): IngestedIntel["severity"] {
  if (score === undefined) return "MEDIUM";
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  return "LOW";
}

/** Cap a free-form description to 4 KB so DB rows stay bounded. */
export function clampDescription(s: string): string {
  return s.length <= 4096 ? s : s.slice(0, 4093) + "…";
}
