/**
 * Phase 27 — Sensor-alert normalization.
 *
 * Maps vendor-specific alert shapes (Wazuh today; future: CrowdStrike
 * Falcon, SentinelOne) into our internal SensorAlert format. The internal
 * shape is deliberately small — just what rule evaluation + the AI need
 * to reason about an alert.
 */

import type { WazuhAlert } from "../integrations/wazuh.js";

export interface NormalizedAlert {
  source: string;
  externalId: string;
  sourceRuleId: string;
  level: number;
  description: string;
  agentName?: string | null;
  srcIp?: string | null;
  dstIp?: string | null;
  /** First MITRE technique the sensor tagged ("T1059.001" etc.), if any. */
  mitreTechniqueId?: string | null;
  rawAlert: object;
}

export function normalizeWazuhAlert(a: WazuhAlert): NormalizedAlert | null {
  // Wazuh alerts without an id can't be deduped — skip them.
  if (!a.id) return null;
  return {
    source: "wazuh",
    externalId:  a.id,
    sourceRuleId: String(a.rule?.id ?? "unknown"),
    level:       a.rule?.level ?? 0,
    description: (a.rule?.description ?? "").slice(0, 1000),
    agentName:   a.agent?.name ?? null,
    srcIp:       a.data?.srcip ?? null,
    dstIp:       a.data?.dstip ?? null,
    mitreTechniqueId: a.rule?.mitre?.id?.[0] ?? null,
    rawAlert:    truncatedRaw(a),
  };
}

/**
 * Cap raw alert size at ~16KB so a chatty full_log doesn't blow up the row.
 * Anything bigger gets the full_log replaced with a head + "(truncated)".
 */
function truncatedRaw(a: WazuhAlert): object {
  const s = JSON.stringify(a);
  if (s.length <= 16_000) return a as unknown as object;
  const copy = { ...a } as WazuhAlert & { full_log?: string };
  if (typeof copy.full_log === "string" && copy.full_log.length > 4_000) {
    copy.full_log = copy.full_log.slice(0, 4_000) + "\n\n[…truncated…]";
  }
  const reduced = JSON.stringify(copy);
  return reduced.length > 16_000
    ? { id: a.id, rule: a.rule, agent: a.agent, truncated: true }
    : (copy as unknown as object);
}
