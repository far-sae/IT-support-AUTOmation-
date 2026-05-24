/**
 * Phase 26 — Recorded Future adapter.
 *
 * Auth: `X-RFToken: <RECORDED_FUTURE_API_KEY>` on every call. No bearer
 * rotation; the key is the credential.
 *
 *   POST {base}/v2/vulnerability/search
 *     body: {
 *       filter: { risk: { gte: 70 }, lastSeen: { gte: "P1D" } },
 *       fields: ["entity","risk","intelCard","timestamps","commonNames"],
 *       limit: 100
 *     }
 *
 * Response shape (trimmed):
 *   {
 *     data: { results: [{
 *       entity: { id, name, type },
 *       risk: { score, evidenceDetails: [{ rule, criticality }], rules },
 *       intelCard: "https://app.recordedfuture.com/live/sc/entity/...",
 *       timestamps: { firstSeen, lastSeen },
 *       commonNames: [...]
 *     }] },
 *     counts: { total, returned }
 *   }
 */

import { env } from "../../env.js";
import { clampDescription, type IngestedIntel, type IngesterSource } from "../types.js";

interface RfVulnResult {
  entity?: { id?: string; name?: string; type?: string };
  risk?: {
    score?: number;
    evidenceDetails?: Array<{ rule?: string; criticality?: number; evidenceString?: string }>;
    rules?: number;
  };
  intelCard?: string;
  timestamps?: { firstSeen?: string; lastSeen?: string };
  commonNames?: string[];
}

interface RfVulnResponse {
  data?: { results?: RfVulnResult[] };
}

function severityFromRfScore(score: number | undefined): IngestedIntel["severity"] {
  if (score === undefined) return "MEDIUM";
  if (score >= 90) return "CRITICAL";
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export const recordedFutureSource: IngesterSource = {
  id: "recorded_future",
  name: "Recorded Future",
  async fetch(): Promise<IngestedIntel[]> {
    if (!env.RECORDED_FUTURE_API_KEY) return [];

    const url = `${env.RECORDED_FUTURE_API_BASE.replace(/\/$/, "")}/v2/vulnerability/search`;
    const body = {
      filter: {
        risk:     { gte: env.RECORDED_FUTURE_MIN_RISK },
        // "P1D" = ISO 8601 duration: last 1 day.
        lastSeen: { gte: "P1D" },
      },
      fields: ["entity", "risk", "intelCard", "timestamps", "commonNames"],
      limit: 100,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "X-RFToken": env.RECORDED_FUTURE_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`Recorded Future /v2/vulnerability/search ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    }
    const parsed = (await resp.json()) as RfVulnResponse;
    const results = parsed.data?.results ?? [];

    return results.map((r) => {
      const cveId = r.entity?.name ?? r.entity?.id ?? "";
      const score = r.risk?.score;
      const rules = r.risk?.evidenceDetails ?? [];
      const ruleLines = rules
        .slice(0, 8)
        .map((e) => `  • ${e.rule ?? "(unnamed)"}${e.criticality != null ? ` [crit=${e.criticality}]` : ""}: ${e.evidenceString ?? ""}`)
        .join("\n");
      const desc = `Recorded Future risk score: ${score ?? "?"}\nMatched rules: ${rules.length}\n${ruleLines}`;
      return {
        kind: "CVE" as const,
        externalId: cveId.trim(),
        title: `${cveId} — RF risk ${score ?? "?"}/${99}`.slice(0, 280),
        description: clampDescription(desc),
        severity: severityFromRfScore(score),
        cvss: undefined,  // RF uses its own risk model — don't conflate with CVSS
        references: [r.intelCard, `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}`]
          .filter((u): u is string => typeof u === "string" && u.length > 0),
        affected: (r.commonNames ?? []).filter(Boolean).slice(0, 20),
        publishedAt: parseDate(r.timestamps?.firstSeen) ?? new Date(),
      };
    }).filter((i) => i.externalId.length > 0);
  },
};

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
