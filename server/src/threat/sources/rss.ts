/**
 * Phase 25 — Security-news RSS / Atom ingester.
 *
 * Polls a comma-separated list of RSS feeds (THREAT_INTEL_RSS_FEEDS).
 * Parses both RSS 2.0 and Atom 1.0 minimally — we don't need every
 * feature, just title + link + summary + date + a stable id.
 *
 * News items often pre-date a formal CVE by hours or days. They land
 * with severity=MEDIUM by default; the AI triage step can promote a
 * specific article based on its content (e.g. "actively exploited",
 * "no patch available yet").
 */

import crypto from "node:crypto";
import { env } from "../../env.js";
import { clampDescription, type IngestedIntel, type IngesterSource } from "../types.js";

// Very small XML extractor — enough for RSS 2.0 and Atom 1.0 envelopes.
// We deliberately do NOT pull in a full XML parser dependency; the
// security-blog feeds we target are all well-formed.

function extractItems(xml: string): Array<{
  title: string; link: string; description: string; pubDate: string | null;
}> {
  // RSS 2.0 <item> ... </item>
  const rssItems = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1] ?? "");
  // Atom 1.0 <entry> ... </entry>
  const atomItems = rssItems.length === 0
    ? [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((m) => m[1] ?? "")
    : [];
  const all = [...rssItems, ...atomItems];
  return all.map((body) => ({
    title:       extractTag(body, "title").trim(),
    link:        extractLink(body),
    description: stripHtml(extractTag(body, "description") || extractTag(body, "summary") || extractTag(body, "content")).trim(),
    pubDate:     extractTag(body, "pubDate") || extractTag(body, "published") || extractTag(body, "updated") || null,
  })).filter((it) => it.title && it.link);
}

function extractTag(body: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(body);
  if (!m) return "";
  return decodeCdata(m[1] ?? "");
}

function extractLink(body: string): string {
  // RSS 2.0: <link>URL</link>
  // Atom: <link href="URL" .../> or <link>URL</link>
  const rss = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(body);
  if (rss && rss[1] && rss[1].trim().length > 0 && !/<link/i.test(rss[1])) {
    return decodeCdata(rss[1]).trim();
  }
  const atom = /<link\b[^>]*\shref=["']([^"']+)["']/i.exec(body);
  return atom?.[1] ?? "";
}

function decodeCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, "$1");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Determine MEDIUM unless the article is plainly raising the bar itself. */
function severityFromTitle(title: string, body: string): IngestedIntel["severity"] {
  const t = `${title} ${body}`.toLowerCase();
  if (/(actively\s+exploited|zero[\s-]?day|in\s+the\s+wild)/.test(t)) return "CRITICAL";
  if (/(critical\s+(flaw|bug|vuln)|max\s+severity|wormable)/.test(t))  return "HIGH";
  return "MEDIUM";
}

export function rssSources(): IngesterSource[] {
  const feeds = env.THREAT_INTEL_RSS_FEEDS.split(",").map((s) => s.trim()).filter(Boolean);
  return feeds.map((feedUrl) => ({
    id: `rss:${feedUrl}`,
    name: `News — ${new URL(feedUrl).hostname}`,
    async fetch(): Promise<IngestedIntel[]> {
      const resp = await fetch(feedUrl, {
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "User-Agent": "relay-server/1.0 (+threat-intel ingester)",
        },
      });
      if (!resp.ok) throw new Error(`RSS ${feedUrl} HTTP ${resp.status}`);
      const xml = await resp.text();
      const items = extractItems(xml);
      return items.slice(0, 50).map((it) => ({
        kind: "NEWS",
        externalId: stableId(feedUrl, it.link),
        title: it.title.slice(0, 280),
        description: clampDescription(it.description),
        severity: severityFromTitle(it.title, it.description),
        references: [it.link],
        affected: [],
        publishedAt: parseDate(it.pubDate) ?? new Date(),
      }));
    },
  }));
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function stableId(feed: string, link: string): string {
  // SHA-1 of the link is short + stable across re-runs.
  return crypto.createHash("sha1").update(`${feed}|${link}`).digest("hex").slice(0, 32);
}

// Export the internals so tests can hit them directly.
export const _internal = { extractItems, severityFromTitle, stripHtml };
