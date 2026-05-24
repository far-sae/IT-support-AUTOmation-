/**
 * Phase 27 — Sensor-alert ingestion engine.
 *
 * Pulls fresh alerts from every configured sensor adapter (Wazuh today)
 * and persists into SensorAlert, deduped by (org, source, externalId).
 *
 * Multi-tenant mapping: Wazuh alerts can carry agent labels that map to
 * an org, but the default deployment is single-tenant per Wazuh manager.
 * For that case we use WAZUH_DEFAULT_ORG_SLUG to associate alerts with a
 * single org. Future multi-tenant work would read a per-agent tag.
 */

import { env } from "../env.js";
import { basePrismaUnscoped } from "../db.js";
import { fetchWazuhAlerts } from "../integrations/wazuh.js";
import { normalizeWazuhAlert, type NormalizedAlert } from "./normalize.js";
import { bus } from "../events/bus.js";

export interface IngestResult {
  fetched: number;
  newAlerts: number;
  organizationsTouched: number;
  error?: string;
}

export async function ingestWazuhAlerts(): Promise<IngestResult> {
  if (!env.WAZUH_API_URL) return { fetched: 0, newAlerts: 0, organizationsTouched: 0 };

  let alerts;
  try { alerts = await fetchWazuhAlerts(200); }
  catch (err) { return { fetched: 0, newAlerts: 0, organizationsTouched: 0, error: (err as Error).message }; }

  if (alerts.length === 0) return { fetched: 0, newAlerts: 0, organizationsTouched: 0 };

  // Resolve target org. Single-tenant default: WAZUH_DEFAULT_ORG_SLUG.
  // Future: derive from agent labels.
  let orgId: string | null = null;
  if (env.WAZUH_DEFAULT_ORG_SLUG) {
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { slug: env.WAZUH_DEFAULT_ORG_SLUG }, select: { id: true },
    });
    orgId = org?.id ?? null;
  }
  if (!orgId) {
    // Try the first non-platform org — better than dropping the data silently.
    const first = await basePrismaUnscoped.organization.findFirst({
      where: { slug: { not: "platform" }, suspendedAt: null },
      select: { id: true }, orderBy: { createdAt: "asc" },
    });
    orgId = first?.id ?? null;
  }
  if (!orgId) {
    return { fetched: alerts.length, newAlerts: 0, organizationsTouched: 0, error: "no target org" };
  }

  let newCount = 0;
  for (const a of alerts) {
    const norm = normalizeWazuhAlert(a);
    if (!norm) continue;
    const created = await persistAlert(orgId, norm);
    if (created) newCount++;
  }

  return { fetched: alerts.length, newAlerts: newCount, organizationsTouched: 1 };
}

async function persistAlert(orgId: string, n: NormalizedAlert): Promise<boolean> {
  const existing = await basePrismaUnscoped.sensorAlert.findUnique({
    where: { organizationId_source_externalId: { organizationId: orgId, source: n.source, externalId: n.externalId } },
    select: { id: true },
  });
  if (existing) return false;
  try {
    const row = await basePrismaUnscoped.sensorAlert.create({
      data: {
        organizationId:   orgId,
        source:           n.source,
        externalId:       n.externalId,
        sourceRuleId:     n.sourceRuleId,
        level:            n.level,
        description:      n.description,
        agentName:        n.agentName ?? null,
        srcIp:            n.srcIp ?? null,
        dstIp:            n.dstIp ?? null,
        mitreTechniqueId: n.mitreTechniqueId ?? null,
        rawAlert:         n.rawAlert,
      },
    });
    // High-severity sensor alerts immediately fan onto the bus so Slack
    // notifiers + metric counters see them in real time.
    if (n.level >= 10) {
      bus.emit({
        kind: "detection.hit",
        organizationId: orgId,
        ruleKey: `sensor:${n.source}:${n.sourceRuleId}`,
        severity: n.level >= 13 ? "CRITICAL" : "HIGH",
        count: 1,
        evidence: {
          sensorAlertId: row.id, source: n.source,
          agentName: n.agentName, description: n.description,
          mitreTechniqueId: n.mitreTechniqueId,
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}
