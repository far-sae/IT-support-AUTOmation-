/**
 * Phase 27 — Detection Rule DSL.
 *
 * A small, safe JSON language the AI can write into and we can evaluate
 * without `eval()`. Deliberately limited: a rule matches sensor alerts
 * by source / rule-id / mitre-technique / level, then triggers when the
 * count over a window exceeds a threshold, optionally grouped by a field.
 *
 * Example:
 *
 *   {
 *     "match": { "mitreTechniqueId": "T1486", "minLevel": 7 },
 *     "window": { "minutes": 10 },
 *     "threshold": { "count": 3, "groupBy": "agentName" }
 *   }
 *
 * Reads: "if 3 or more sensor alerts in the last 10 minutes match MITRE
 * T1486 (Data Encrypted for Impact, i.e. ransomware) on the same agent,
 * fire."
 *
 * The DSL is purposefully thin — enough to express most behavioural
 * patterns, simple enough to validate, audit, and execute safely.
 */

export interface RuleMatch {
  source?:           string;            // "wazuh"
  sourceRuleId?:     string;            // e.g. Wazuh rule.id
  mitreTechniqueId?: string;            // e.g. "T1486"
  /** Lower bound (inclusive) on sensor severity level. */
  minLevel?:         number;
  /** Substring match on the alert description (case-insensitive). */
  descriptionContains?: string;
}

export interface RuleWindow {
  minutes: number;
}

export interface RuleThreshold {
  count:   number;
  /** Field to group by (e.g. "agentName" or "srcIp"). Absent = no grouping. */
  groupBy?: keyof RuleMatchableAlert;
}

export interface RuleSpec {
  match:     RuleMatch;
  window:    RuleWindow;
  threshold: RuleThreshold;
}

/** Shape an alert must minimally satisfy for rule evaluation. */
export interface RuleMatchableAlert {
  source:           string;
  sourceRuleId:     string;
  level:            number;
  description:      string;
  mitreTechniqueId: string | null;
  agentName:        string | null;
  srcIp:            string | null;
  dstIp:            string | null;
  createdAt:        Date;
}

/** Strict-ish validation; throws with a human-friendly reason. */
export function validateRuleSpec(spec: unknown): RuleSpec {
  if (!spec || typeof spec !== "object") throw new Error("rule spec must be an object");
  const s = spec as Record<string, unknown>;
  const match     = s.match     as Record<string, unknown> | undefined;
  const window    = s.window    as Record<string, unknown> | undefined;
  const threshold = s.threshold as Record<string, unknown> | undefined;
  if (!match || typeof match !== "object")     throw new Error("rule.match required");
  if (!window || typeof window !== "object")   throw new Error("rule.window required");
  if (!threshold || typeof threshold !== "object") throw new Error("rule.threshold required");
  const mins = Number(window.minutes);
  if (!Number.isFinite(mins) || mins <= 0 || mins > 1440) {
    throw new Error("rule.window.minutes must be 1..1440");
  }
  const cnt = Number(threshold.count);
  if (!Number.isInteger(cnt) || cnt < 1 || cnt > 1000) {
    throw new Error("rule.threshold.count must be 1..1000");
  }
  return spec as RuleSpec;
}

/** Does one alert satisfy the .match clause? */
export function alertMatches(spec: RuleSpec, a: RuleMatchableAlert): boolean {
  const m = spec.match;
  if (m.source !== undefined           && a.source !== m.source)                           return false;
  if (m.sourceRuleId !== undefined     && a.sourceRuleId !== m.sourceRuleId)               return false;
  if (m.mitreTechniqueId !== undefined && a.mitreTechniqueId !== m.mitreTechniqueId)       return false;
  if (m.minLevel !== undefined         && a.level < m.minLevel)                            return false;
  if (m.descriptionContains !== undefined &&
      !a.description.toLowerCase().includes(m.descriptionContains.toLowerCase()))           return false;
  return true;
}

/**
 * Walk an alert list, return groups (or one synthetic "_" group when no
 * groupBy) that crossed the threshold within the window leading up to `now`.
 */
export function evaluateRule(
  spec: RuleSpec, alerts: RuleMatchableAlert[], now: Date = new Date(),
): Array<{ group: string; count: number; alertIds: number[] }> {
  const windowStart = new Date(now.getTime() - spec.window.minutes * 60 * 1000);
  const groups = new Map<string, { count: number; alertIds: number[] }>();
  for (let i = 0; i < alerts.length; i++) {
    const a = alerts[i]!;
    if (a.createdAt < windowStart) continue;
    if (!alertMatches(spec, a))     continue;
    const groupKey = spec.threshold.groupBy
      ? String(a[spec.threshold.groupBy] ?? "_null_")
      : "_";
    const cur = groups.get(groupKey) ?? { count: 0, alertIds: [] };
    cur.count++;
    cur.alertIds.push(i);
    groups.set(groupKey, cur);
  }
  return [...groups.entries()]
    .filter(([, v]) => v.count >= spec.threshold.count)
    .map(([group, v]) => ({ group, count: v.count, alertIds: v.alertIds }));
}
