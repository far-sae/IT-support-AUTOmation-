/**
 * Phase 25 — Threat-intel engine.
 *
 * Ticks every THREAT_INTEL_INTERVAL_MINUTES:
 *   1. Pull from every enabled source (CISA KEV / NVD / GHSA / RSS).
 *   2. Upsert each into ThreatIntel (dedupe by source + externalId).
 *   3. For every NEW intel of CRITICAL or HIGH severity, walk every
 *      non-platform org and try to match against their inventory.
 *   4. Persist matches; for CRITICAL matches against actual assets, fire
 *      a Slack notification + Prometheus counter + optionally auto-open
 *      a ticket.
 */

import { basePrismaUnscoped } from "../db.js";
import { env } from "../env.js";
import { bus } from "../events/bus.js";
import { cisaKevSource }        from "./sources/cisa-kev.js";
import { ghsaSource }           from "./sources/ghsa.js";
import { nvdSource }            from "./sources/nvd.js";
import { rssSources }           from "./sources/rss.js";
import { mandiantSource }       from "./sources/mandiant.js";
import { recordedFutureSource } from "./sources/recorded_future.js";
import { crowdstrikeSource }    from "./sources/crowdstrike.js";
import { matchIntelForOrg, persistMatches } from "./matcher.js";
import type { IngestedIntel, IngesterSource } from "./types.js";

export interface IngestRunResult {
  source: string;
  fetched: number;
  newIntel: number;
  newMatches: number;
  error?: string;
}

function sources(): IngesterSource[] {
  // Commercial sources self-skip (return []) when their API keys aren't set,
  // so they're safe to include unconditionally.
  return [
    cisaKevSource,
    mandiantSource,
    recordedFutureSource,
    crowdstrikeSource,
    ghsaSource,
    nvdSource,
    ...rssSources(),
  ];
}

/** Run one ingester end-to-end. */
export async function ingestOneSource(src: IngesterSource): Promise<IngestRunResult> {
  let fetched: IngestedIntel[];
  try {
    fetched = await src.fetch();
  } catch (err) {
    return { source: src.id, fetched: 0, newIntel: 0, newMatches: 0, error: (err as Error).message };
  }

  let newIntel = 0;
  let newMatches = 0;
  const orgs = await basePrismaUnscoped.organization.findMany({
    where: { slug: { not: "platform" }, suspendedAt: null },
    select: { id: true },
  });

  for (const item of fetched) {
    const existing = await basePrismaUnscoped.threatIntel.findUnique({
      where: { source_externalId: { source: src.id, externalId: item.externalId } },
      select: { id: true },
    });
    if (existing) continue;

    // Defensive — filter any nullish entries vendors sometimes return,
    // since Prisma rejects `undefined` inside JSON arrays.
    const cleanRefs     = (item.references ?? []).filter((s): s is string => typeof s === "string" && s.length > 0);
    const cleanAffected = (item.affected   ?? []).filter((s): s is string => typeof s === "string" && s.length > 0);
    const row = await basePrismaUnscoped.threatIntel.create({
      data: {
        kind:        item.kind,
        source:      src.id,
        externalId:  item.externalId,
        title:       item.title,
        description: item.description,
        severity:    item.severity,
        cvss:        item.cvss ?? null,
        references:  cleanRefs as object,
        affected:    cleanAffected as object,
        ...(item.kevMetadata ? { kevMetadata: item.kevMetadata as object } : {}),
        publishedAt: item.publishedAt,
      },
    });
    newIntel++;

    // Only attempt asset matching for actionable severities + types.
    if (item.severity === "CRITICAL" || item.severity === "HIGH") {
      if (item.kind === "CVE" || item.kind === "KEV" || item.kind === "ADVISORY") {
        for (const o of orgs) {
          const matches = await matchIntelForOrg(o.id, {
            id: row.id, affected: item.affected,
            description: item.description, title: item.title,
          });
          if (matches.length > 0) {
            newMatches += await persistMatches(matches);
            for (const m of matches) {
              bus.emit({
                kind: "detection.hit",
                organizationId: m.organizationId,
                ruleKey: `threat_intel:${src.id}`,
                severity: item.severity,
                count: 1,
                evidence: {
                  threatIntelId: row.id,
                  cveId: item.externalId,
                  title: item.title,
                  reason: m.reason,
                  ...m.evidence,
                },
              });
            }
          }
        }
      }
    }
  }
  return { source: src.id, fetched: fetched.length, newIntel, newMatches };
}

/** Run every enabled source. */
export async function ingestAll(): Promise<IngestRunResult[]> {
  const results: IngestRunResult[] = [];
  for (const src of sources()) {
    const r = await ingestOneSource(src);
    results.push(r);
    if (r.error) console.error(`[threat-intel] ${src.id} failed: ${r.error}`);
    else console.log(`[threat-intel] ${src.id}: fetched=${r.fetched} new=${r.newIntel} matches=${r.newMatches}`);
  }
  return results;
}
