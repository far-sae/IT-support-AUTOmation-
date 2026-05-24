/**
 * Relay triage engine.
 *
 * A transparent, rule-based classifier that maps free-text ticket descriptions
 * onto { category, priority, assignedTeam, slaTarget, confidence, matchedKeywords }.
 *
 * Set USE_AI_TRIAGE=true in env to route through Anthropic's claude-sonnet-4-5
 * with a strict JSON contract; the rule engine remains the fallback on any
 * error (network, schema, timeout, etc).
 */

import Anthropic from "@anthropic-ai/sdk";

// ─── Public types ─────────────────────────────────────────────────────

export type Category =
  | "Network"
  | "Hardware"
  | "Account & Access"
  | "Email"
  | "Security"
  | "Software";

export type Priority = "Critical" | "High" | "Medium" | "Low";

export interface TriageResult {
  category: Category;
  priority: Priority;
  assignedTeam: string;
  slaTarget: string;
  confidence: number;
  matchedKeywords: string[];
}

// ─── Static maps ──────────────────────────────────────────────────────

export const CATEGORY_TO_TEAM: Record<Category, string> = {
  Network: "Network Operations",
  Hardware: "Desktop Support",
  "Account & Access": "Identity & Access",
  Email: "Messaging Team",
  Security: "Security Team",
  Software: "Application Support",
};

export const PRIORITY_TO_SLA: Record<Priority, string> = {
  Critical: "1 hour",
  High: "4 hours",
  Medium: "1 business day",
  Low: "3 business days",
};

// Window used to compute slaDueAt at ticket creation time.
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_BUSINESS_DAY_MS = 8 * ONE_HOUR_MS;

export const PRIORITY_TO_SLA_MS: Record<Priority, number> = {
  Critical: 1 * ONE_HOUR_MS,
  High: 4 * ONE_HOUR_MS,
  Medium: 1 * ONE_BUSINESS_DAY_MS,
  Low: 3 * ONE_BUSINESS_DAY_MS,
};

// ─── Keyword dictionaries ─────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  Network: [
    "vpn", "wifi", "wi-fi", "internet", "network", "lan", "wan", "dns",
    "dhcp", "ping", "ethernet", "router", "firewall", "proxy", "offline",
    "no connection", "can't connect", "cannot connect",
  ],
  Hardware: [
    "laptop", "desktop", "monitor", "screen", "keyboard", "mouse",
    "printer", "scanner", "battery", "charger", "power", "dock",
    "docking station", "headset", "webcam", "hard drive", "ssd",
    "won't turn on", "wont turn on", "no power",
  ],
  "Account & Access": [
    "password", "mfa", "2fa", "login", "log in", "log-in", "sign in",
    "sign-in", "locked", "locked out", "account", "access", "sso",
    "single sign on", "reset", "unlock", "permission", "permissions",
    "okta", "azure ad",
  ],
  Email: [
    "outlook", "email", "e-mail", "mailbox", "calendar", "exchange",
    "smtp", "imap", "spam", "junk", "distribution list", "dl ",
    "shared mailbox", "out of office", "ooo",
  ],
  Security: [
    "phishing", "phish", "malware", "virus", "ransomware", "breach",
    "breached", "suspicious", "compromised", "compromise", "security",
    "leaked", "leak", "data loss", "incident",
  ],
  Software: [
    "install", "uninstall", "software", "application", "app ", "license",
    "licence", "activation", "slack", "teams", "zoom", "jira",
    "office", "excel", "word", "powerpoint", "onedrive", "sharepoint",
    "error", "crash", "crashed", "crashing", "freeze", "frozen",
    "update", "upgrade", "patch",
  ],
};

const PRIORITY_KEYWORDS: Record<Priority, string[]> = {
  Critical: [
    "outage", "down", "production down", "completely down", "entire team",
    "all users", "everyone", "company-wide", "company wide",
    "can't work", "cannot work", "ceo", "cfo", "executive", "payroll",
    "ransomware", "breach", "data loss", "urgent emergency", "emergency",
  ],
  High: [
    "blocked", "blocking", "deadline", "urgent", "asap", "as soon as possible",
    "multiple users", "several users", "important", "critical",
    "escalate", "right now", "before end of day", "by eod",
  ],
  Medium: [
    "slow", "intermittent", "sometimes", "occasionally", "lag", "laggy",
    "please help", "having trouble", "issue",
  ],
  Low: [
    "question", "how do i", "how to", "request", "when you get a chance",
    "whenever", "no rush", "minor", "low priority", "fyi",
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────

interface ScoreResult<T extends string> {
  label: T;
  matched: string[];
  score: number;
}

function scoreLabels<T extends string>(
  haystack: string,
  dict: Record<T, string[]>,
): ScoreResult<T>[] {
  const text = haystack.toLowerCase();
  const results: ScoreResult<T>[] = [];
  for (const label of Object.keys(dict) as T[]) {
    const matched: string[] = [];
    for (const kw of dict[label]) {
      if (text.includes(kw)) matched.push(kw.trim());
    }
    results.push({ label, matched, score: matched.length });
  }
  // Stable order: highest score first; ties broken by dictionary order.
  results.sort((a, b) => b.score - a.score);
  return results;
}

function categoryConfidence(matches: number): number {
  if (matches === 0) return 0.25;
  return Math.min(1, 0.45 + 0.18 * matches);
}

function priorityConfidence(matches: number): number {
  if (matches === 0) return 0.5; // default-Medium fallback
  return Math.min(1, 0.5 + 0.15 * matches);
}

export function computeSlaDueAt(priority: Priority, from: Date = new Date()): Date {
  return new Date(from.getTime() + PRIORITY_TO_SLA_MS[priority]);
}

// ─── Rule engine ──────────────────────────────────────────────────────

export function triage(text: string): TriageResult {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return {
      category: "Software",
      priority: "Medium",
      assignedTeam: CATEGORY_TO_TEAM.Software,
      slaTarget: PRIORITY_TO_SLA.Medium,
      confidence: 0.2,
      matchedKeywords: [],
    };
  }

  const catScores = scoreLabels<Category>(trimmed, CATEGORY_KEYWORDS);
  const priScores = scoreLabels<Priority>(trimmed, PRIORITY_KEYWORDS);

  const top = catScores[0];
  const topCategory: Category = (top && top.score > 0 ? top.label : "Software");
  const topMatches = top?.matched ?? [];

  const topPri = priScores[0];
  const topPriority: Priority = (topPri && topPri.score > 0 ? topPri.label : "Medium");
  const topPriMatches = topPri?.matched ?? [];

  const catConf = categoryConfidence(topMatches.length);
  const priConf = priorityConfidence(topPriMatches.length);
  const confidence = Math.round(((catConf + priConf) / 2) * 100) / 100;

  return {
    category: topCategory,
    priority: topPriority,
    assignedTeam: CATEGORY_TO_TEAM[topCategory],
    slaTarget: PRIORITY_TO_SLA[topPriority],
    confidence,
    matchedKeywords: Array.from(new Set([...topMatches, ...topPriMatches])),
  };
}

// ─── Auto-reply drafter ───────────────────────────────────────────────

export interface AutoReplyInput {
  submitterName: string;
  refCode: string;
  category: Category;
  priority: Priority;
  assignedTeam: string;
  slaTarget: string;
}

export function generateAutoReply(input: AutoReplyInput): string {
  const { submitterName, refCode, category, priority, assignedTeam, slaTarget } = input;
  const firstName = (submitterName || "").split(" ")[0] || "there";
  return [
    `Hi ${firstName},`,
    ``,
    `Thanks for reaching out — we've logged your request as ${refCode} and the ${assignedTeam} team has it.`,
    ``,
    `Here's what we picked up:`,
    `  • Category: ${category}`,
    `  • Priority: ${priority}`,
    `  • Target response time: ${slaTarget}`,
    ``,
    `You'll hear back from us within the target response window. In the meantime, you can reply to this email with anything else that might help us resolve it faster (error messages, screenshots, when it started).`,
    ``,
    `— Relay IT Support`,
  ].join("\n");
}

// ─── Optional AI path ─────────────────────────────────────────────────

const AI_MODEL = "claude-sonnet-4-5";

const AI_SYSTEM_PROMPT = `You are Relay's IT helpdesk triage classifier. Read the user's ticket description and return a SINGLE JSON object — no prose, no markdown, no code fences — with EXACTLY these keys:

{
  "category": one of ["Network","Hardware","Account & Access","Email","Security","Software"],
  "priority": one of ["Critical","High","Medium","Low"],
  "matchedKeywords": string[]  // 0-8 short phrases from the description that drove your decision
}

Rules:
- Critical means a current business-impacting outage or active security incident (e.g. ransomware, breach, executive can't work, full team down).
- High means blocking or deadline-pressured work for one or a few users.
- Medium is the default for normal incidents that aren't blocking.
- Low is questions, requests, or "whenever you get a chance" items.
- Pick the single best category. If genuinely ambiguous, choose the category that the responding team would most likely own.
- Output JSON ONLY.`;

interface AiTriagePayload {
  category: Category;
  priority: Priority;
  matchedKeywords: string[];
}

function isCategory(x: unknown): x is Category {
  return typeof x === "string" && x in CATEGORY_TO_TEAM;
}

function isPriority(x: unknown): x is Priority {
  return typeof x === "string" && x in PRIORITY_TO_SLA;
}

function parseAiPayload(raw: string): AiTriagePayload | null {
  try {
    const trimmed = raw.trim().replace(/^```(?:json)?|```$/g, "").trim();
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (!isCategory(obj.category)) return null;
    if (!isPriority(obj.priority)) return null;
    const matchedRaw = obj.matchedKeywords;
    const matched: string[] = Array.isArray(matchedRaw)
      ? matchedRaw.filter((v): v is string => typeof v === "string").slice(0, 8)
      : [];
    return { category: obj.category, priority: obj.priority, matchedKeywords: matched };
  } catch {
    return null;
  }
}

/**
 * AI-powered triage. Calls Anthropic and validates the JSON response.
 * Returns null on ANY error so the caller can fall back to the rule engine.
 */
export async function triageWithAI(text: string): Promise<TriageResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 256,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });

    const block = resp.content.find((c) => c.type === "text");
    if (!block || block.type !== "text") return null;

    const payload = parseAiPayload(block.text);
    if (!payload) return null;

    return {
      category: payload.category,
      priority: payload.priority,
      assignedTeam: CATEGORY_TO_TEAM[payload.category],
      slaTarget: PRIORITY_TO_SLA[payload.priority],
      confidence: 0.9,
      matchedKeywords: payload.matchedKeywords,
    };
  } catch {
    return null;
  }
}

/**
 * Convenience: respects USE_AI_TRIAGE. Always returns a TriageResult.
 */
export async function triageAuto(text: string): Promise<TriageResult> {
  const useAi = (process.env.USE_AI_TRIAGE ?? "").toLowerCase() === "true";
  if (useAi) {
    const ai = await triageWithAI(text);
    if (ai) return ai;
  }
  return triage(text);
}
