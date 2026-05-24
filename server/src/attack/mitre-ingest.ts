/**
 * Phase 27 — MITRE ATT&CK enterprise ingester.
 *
 * MITRE publishes the entire ATT&CK framework as a single STIX 2.1 JSON
 * bundle. We pull it, walk the `attack-pattern` objects, and upsert into
 * AttackTechnique. The dataset is ~600 techniques + ~200 sub-techniques.
 *
 * Source: https://github.com/mitre/cti (Apache 2.0 licensed).
 *
 * Each ATT&CK technique has:
 *   • external_id    — "T1059", "T1059.001"
 *   • name           — human title
 *   • kill_chain_phases[].phase_name — tactic (execution, persistence, …)
 *   • x_mitre_platforms — Windows / Linux / macOS / etc.
 *   • x_mitre_data_sources — what telemetry detects this
 *   • revoked / x_mitre_deprecated — keep but mark
 *
 * Idempotent: re-runs upsert by mitreId; revoked techniques flip the flag
 * but stay in the table for historical generated-rules to reference.
 */

import { env } from "../env.js";
import { basePrismaUnscoped } from "../db.js";

interface StixObject {
  type: string;
  id: string;
  name?: string;
  description?: string;
  external_references?: Array<{ source_name?: string; external_id?: string; url?: string }>;
  kill_chain_phases?: Array<{ kill_chain_name?: string; phase_name?: string }>;
  modified?: string;
  revoked?: boolean;
  x_mitre_deprecated?: boolean;
  x_mitre_platforms?: string[];
  x_mitre_data_sources?: string[];
}

interface StixBundle {
  type: string;
  id?: string;
  objects?: StixObject[];
}

export interface IngestResult {
  techniquesUpserted: number;
  techniquesRevoked: number;
  bundleObjects: number;
  durationMs: number;
}

export async function ingestMitreAttack(): Promise<IngestResult> {
  const start = Date.now();
  const resp = await fetch(env.MITRE_ATTACK_URL, {
    headers: { Accept: "application/json", "User-Agent": "relay-server/1.0" },
  });
  if (!resp.ok) {
    throw new Error(`MITRE ATT&CK fetch ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  }
  const bundle = (await resp.json()) as StixBundle;
  if (!Array.isArray(bundle.objects)) {
    throw new Error("MITRE ATT&CK bundle missing `objects` array");
  }

  let upserted = 0;
  let revoked = 0;

  for (const o of bundle.objects) {
    // Only attack-pattern objects are techniques.
    if (o.type !== "attack-pattern") continue;
    const mitreRef = (o.external_references ?? []).find(
      (r) => r.source_name === "mitre-attack" && typeof r.external_id === "string",
    );
    if (!mitreRef?.external_id) continue;
    const mitreId = mitreRef.external_id;

    // Tactic comes from the first kill-chain phase tagged with the
    // mitre-attack kill chain. There's always at least one.
    const tactic = (o.kill_chain_phases ?? [])
      .find((p) => p.kill_chain_name === "mitre-attack")
      ?.phase_name ?? "unknown";

    const isRevoked = Boolean(o.revoked || o.x_mitre_deprecated);
    if (isRevoked) revoked++;

    await basePrismaUnscoped.attackTechnique.upsert({
      where: { mitreId },
      create: {
        mitreId,
        name: (o.name ?? mitreId).slice(0, 280),
        tactic,
        description: (o.description ?? "").slice(0, 8000),
        dataSources: (o.x_mitre_data_sources ?? []) as object,
        platforms:   (o.x_mitre_platforms ?? [])    as object,
        mitigations: [] as unknown as object,  // relationships ingested separately if needed
        revoked: isRevoked,
        modified: o.modified ? new Date(o.modified) : new Date(),
      },
      update: {
        name: (o.name ?? mitreId).slice(0, 280),
        tactic,
        description: (o.description ?? "").slice(0, 8000),
        dataSources: (o.x_mitre_data_sources ?? []) as object,
        platforms:   (o.x_mitre_platforms ?? [])    as object,
        revoked: isRevoked,
        modified: o.modified ? new Date(o.modified) : new Date(),
      },
    });
    upserted++;
  }

  return {
    techniquesUpserted: upserted,
    techniquesRevoked: revoked,
    bundleObjects: bundle.objects.length,
    durationMs: Date.now() - start,
  };
}
