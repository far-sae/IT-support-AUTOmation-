/**
 * kb_deflection — LOW risk.
 *
 * Match:   any category. Searches the org's KbArticle table for the best
 *          match by keyword overlap; threshold tuned so a clear hit fires
 *          but a generic ticket doesn't.
 * Execute: posts the article's steps to the ticket and asks the submitter
 *          to confirm via Yes/No buttons.
 *
 * Unlike the rest of the runbooks this one does a small DB read at match
 * time so we can attach the chosen article id to the decision payload.
 * The matcher is async-friendly through a side channel; the engine awaits
 * it before deciding.
 */

import type { Runbook, RunbookContext, RunbookMatch } from "./types.js";
import { prisma } from "../db.js";

interface KbHit {
  id: string;
  title: string;
  category: string;
  steps: string[];
  score: number;
}

// Side-channel cache: matched article per ticketId for the duration of a
// single request. Cleared once the execute() finishes.
const matched = new Map<string, KbHit>();

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

async function bestKbHit(ctx: RunbookContext): Promise<KbHit | null> {
  const articles = await prisma.kbArticle.findMany({
    orderBy: { helpedCount: "desc" },
    select: { id: true, title: true, category: true, steps: true, keywords: true, helpedCount: true },
    take: 50,
  });

  const ticketTokens = new Set(tokenize(ctx.ticket.description));

  let best: KbHit | null = null;
  for (const a of articles) {
    const keywords = Array.isArray(a.keywords) ? (a.keywords as unknown as string[]) : [];
    const articleTokens = new Set<string>([
      ...tokenize(a.title),
      ...keywords.flatMap(tokenize),
    ]);
    let overlap = 0;
    for (const t of articleTokens) if (ticketTokens.has(t)) overlap += 1;
    const categoryBoost = a.category === ctx.triage.category ? 1.5 : 0;
    const score = overlap + categoryBoost + Math.log1p(a.helpedCount) * 0.3;
    if (!best || score > best.score) {
      best = {
        id: a.id, title: a.title, category: a.category,
        steps: Array.isArray(a.steps) ? (a.steps as unknown as string[]) : [],
        score,
      };
    }
  }
  return best && best.score >= 3 ? best : null;
}

export const kbDeflectionRunbook: Runbook = {
  key: "kb_deflection",
  name: "Knowledge-base deflection",
  description: "Auto-reply with the top KB article when one matches the ticket — usually closes the easy ones without a human agent ever touching them.",
  risk: "LOW",

  // The Runbook interface's match is sync; we kick off an async lookup and
  // resolve the score from a cached promise inside the engine.
  match(_ctx: RunbookContext): RunbookMatch {
    // Always-on candidate; the engine calls `prepare` (below) which fills
    // the cache. If nothing was cached, score 0.
    const ticketId = _ctx.ticket.id;
    const hit = matched.get(ticketId);
    if (!hit) return { confidence: 0, reason: "no KB candidate prepared" };
    // Map raw overlap score to a 0-1 confidence band.
    const conf = Math.min(0.75, 0.4 + hit.score * 0.05);
    return { confidence: conf, reason: `KB article "${hit.title}" (score ${hit.score.toFixed(1)})` };
  },

  async execute(ctx) {
    const hit = matched.get(ctx.ticket.id);
    matched.delete(ctx.ticket.id);
    if (!hit) {
      return {
        status: "FAILED",
        publicComment: "",
        decision: { error: "no KB hit at execute time" },
      };
    }

    const steps = hit.steps.length
      ? hit.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(article has no steps)";

    return {
      status: "AWAITING_USER",
      publicComment:
        `Hi ${ctx.ticket.submitterName.split(" ")[0] ?? "there"} — this looks like a known one. Try these steps from our KB article **${hit.title}**:\n` +
        `\n${steps}\n` +
        `\n` +
        `Let me know via the **Yes, it worked** / **No, still broken** buttons below. If it didn't work I'll escalate to a human right away.\n` +
        `\n` +
        `— Relay auto-remediation`,
      internalNote: `Suggested KB article "${hit.title}" (id=${hit.id}).`,
      decision: {
        action: "suggest_kb_article",
        articleId: hit.id,
        articleTitle: hit.title,
        score: hit.score,
      },
    };
  },
};

/**
 * Engine hook — called by the orchestrator BEFORE match() to populate the
 * cache with the best KB hit (if any). Other runbooks don't need this.
 */
export async function prepareKbDeflection(ctx: RunbookContext): Promise<void> {
  const hit = await bestKbHit(ctx);
  if (hit) matched.set(ctx.ticket.id, hit);
}
