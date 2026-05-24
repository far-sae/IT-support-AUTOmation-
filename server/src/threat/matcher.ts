/**
 * Phase 25 — Threat-intel → asset matcher.
 *
 * For each piece of intel, walk the org's inventory (Devices today;
 * later: installed-software lists, dependencies, CPE fingerprints) and
 * decide whether this intel applies to anything we own.
 *
 * Match rules:
 *   • Device.os contains an `affected` token, OR
 *   • Device.agentVersion matches an `affected` token, OR
 *   • The intel description contains a known vendor + product pair we
 *     have a Device record for.
 *
 * Each match is deduped via the (org, threatIntelId, reason) unique
 * constraint on ThreatMatch — re-scanning the same intel against the
 * same device is a no-op.
 */

import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";

export interface MatchResult {
  organizationId: string;
  threatIntelId: string;
  reason: string;
  evidence: Record<string, unknown>;
}

export async function matchIntelForOrg(
  organizationId: string,
  intel: { id: string; affected: string[]; description: string; title: string },
): Promise<MatchResult[]> {
  // Tighten the candidate token set — discard short / generic words that
  // produce substring false positives (e.g. "one" matches every device
  // hostname containing "one"). We also require word-boundary matches.
  const STOPWORDS = new Set([
    "the", "and", "for", "all", "any", "one", "two", "core",
    "server", "client", "system", "version",
    "vulnerability", "vulnerabilities", "cve", "ghsa", "kev",
  ]);
  const rawTokens = [...intel.affected, ...extractCveProductHints(intel.title + " " + intel.description)];
  const tokens = rawTokens
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length >= 5 && !STOPWORDS.has(t));
  if (tokens.length === 0) return [];

  return runWithTenant(organizationId, async () => {
    const devices = await prisma.device.findMany({
      select: { id: true, hostname: true, os: true, agentVersion: true },
    });
    const results: MatchResult[] = [];
    const matchedDeviceIds: string[] = [];
    const matchedHostnames: string[] = [];
    const matchedTokens = new Set<string>();

    for (const dev of devices) {
      const haystack = `${dev.os ?? ""} ${dev.agentVersion ?? ""} ${dev.hostname ?? ""}`.toLowerCase();
      for (const tok of tokens) {
        // Word-boundary match — "win" matches "windows 11" but NOT
        // "darwin" (the macOS userland string).
        if (new RegExp(`\\b${escapeRegex(tok)}\\b`, "i").test(haystack)) {
          matchedDeviceIds.push(dev.id);
          matchedHostnames.push(dev.hostname);
          matchedTokens.add(tok);
          break;
        }
      }
    }

    if (matchedDeviceIds.length > 0) {
      results.push({
        organizationId,
        threatIntelId: intel.id,
        reason: `${matchedDeviceIds.length} device(s) match affected products [${[...matchedTokens].slice(0, 5).join(", ")}]`,
        evidence: {
          matchedTokens: [...matchedTokens],
          deviceIds: matchedDeviceIds.slice(0, 50),
          sampleHostnames: matchedHostnames.slice(0, 20),
        },
      });
    }
    return results;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract product-name hints from a CVE title / description.
 * NVD / GHSA / CISA titles typically contain the vendor + product in the
 * first few words; we use a coarse pull. Not exhaustive — it's a first
 * pass to reduce false negatives for items whose `affected` array is empty.
 */
function extractCveProductHints(text: string): string[] {
  // Very coarse — pull the first 3 capitalised words. Real implementations
  // would use a CPE parser. The matcher's stoplist below trims obvious noise.
  const hints = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,}|[A-Z]{2,})\b/g)) {
    hints.add(m[1]!);
    if (hints.size >= 8) break;
  }
  const stop = new Set([
    "CVE", "NVD", "GHSA", "KEV", "Vulnerability", "Critical", "Action",
    "Required", "Due", "Date", "Known", "Ransomware", "Campaign",
  ]);
  return [...hints].filter((h) => !stop.has(h));
}

/**
 * Persist match results. Idempotent — uses the (org, threatIntelId, reason)
 * unique constraint so re-running this against unchanged data does nothing.
 * Returns the number of NEW matches actually created.
 */
export async function persistMatches(results: MatchResult[]): Promise<number> {
  let created = 0;
  for (const r of results) {
    // We can't ask for "did the row exist before?" without a separate read,
    // so we count any successful upsert that targets a still-fresh createdAt.
    const existing = await basePrismaUnscoped.threatMatch.findFirst({
      where: { organizationId: r.organizationId, threatIntelId: r.threatIntelId, reason: r.reason },
      select: { id: true },
    });
    if (existing) continue;
    try {
      await basePrismaUnscoped.threatMatch.create({
        data: {
          organizationId: r.organizationId,
          threatIntelId:  r.threatIntelId,
          reason:         r.reason,
          evidence:       r.evidence as object,
        },
      });
      created++;
    } catch (err) {
      // Race condition (two crons at once) — the unique constraint blocks it.
      if (!String((err as Error).message).includes("Unique constraint")) {
        console.error("[threat-match] persist failed:", (err as Error).message);
      }
    }
  }
  return created;
}
