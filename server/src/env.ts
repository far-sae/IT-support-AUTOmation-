/**
 * Validated, typed environment configuration.
 * Throws on startup if a required value is missing or malformed.
 */

import "dotenv/config";
import { z } from "zod";

// Treat empty strings as "not set" — `${VAR:-}` in docker-compose expands to
// "", which would otherwise fail .min(1) validation on truly optional values.
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);
const truthy = z.preprocess(
  (v) => {
    if (typeof v !== "string") return Boolean(v);
    if (v.trim() === "") return false;
    return v.toLowerCase() === "true";
  },
  z.boolean(),
);
const optionalPort = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().url().default("http://localhost:5173"),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  USE_AI_TRIAGE: truthy.default(false),
  // Phase 10B — when true + ANTHROPIC_API_KEY present, the autopilot brain
  // routes its decisions through Claude tool-use. Falls back to the rule
  // engine otherwise.
  USE_AI_BRAIN: truthy.default(false),
  ANTHROPIC_API_KEY: optionalString,
  // Model + iteration cap for the agentic loop.
  BRAIN_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  BRAIN_MAX_ITERATIONS: z.coerce.number().int().positive().default(6),
  // How often the autopilot cron ticks (minutes).
  AUTOPILOT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(1),

  // SMTP — used in Phase 3, optional now.
  SMTP_HOST: optionalString,
  SMTP_PORT: optionalPort,
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: z.string().default("Relay Support <support@relay.local>"),

  // IMAP — Phase 3, optional.
  IMAP_HOST: optionalString,
  IMAP_PORT: optionalPort,
  IMAP_USER: optionalString,
  IMAP_PASS: optionalString,
  IMAP_TLS: truthy.default(true),
  IMAP_POLL_SECONDS: z.coerce.number().int().positive().default(60),
  // Multi-tenant inbound email: which organization to file IMAP-polled
  // messages into when the To address doesn't carry an explicit slug.
  IMAP_DEFAULT_ORG_SLUG: optionalString,

  // OAuth
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  MICROSOFT_CLIENT_ID: optionalString,
  MICROSOFT_CLIENT_SECRET: optionalString,
  MICROSOFT_TENANT: z.string().default("common"),
  OAUTH_CALLBACK_BASE_URL: z.string().url().default("http://localhost:4000"),

  // Object storage — Phase 3.
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("relay-attachments"),
  S3_ACCESS_KEY: optionalString,
  S3_SECRET_KEY: optionalString,
  S3_FORCE_PATH_STYLE: truthy.default(true),

  SLA_CHECK_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),

  // Phase 7 — devices that haven't checked in for longer than this are flagged
  // "stale" on the assets page (badge + analytics).
  AGENT_STALE_MINUTES: z.coerce.number().int().positive().default(15),

  // Phase 11 — closed-loop autopilot.
  // Optional: a default Slack webhook used when an org hasn't set its own.
  SLACK_WEBHOOK_URL: optionalString,
  // Optional: GitHub PAT for the github_dispatch runbook / Co-pilot button.
  // Needs the `workflow` scope to call workflow_dispatch.
  GITHUB_TOKEN: optionalString,
  // Cron expression for the morning brief at the platform level.
  // Per-org override via Organization.settings.briefSchedule. Default 08:00 UTC daily.
  DAILY_BRIEF_CRON: z.string().default("0 8 * * *"),

  // Phase 12 — detection engine.
  // Interval (minutes) the rule runner ticks at. Default 5.
  DETECTION_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),

  // Phase 12 — Kafka event bus (optional).
  // Comma-separated broker list ("kafka-1:9092,kafka-2:9092"). If unset the
  // bus runs in-process only.
  KAFKA_BROKERS: optionalString,
  KAFKA_CLIENT_ID: z.string().default("relay-server"),
  KAFKA_TOPIC_PREFIX: z.string().default("relay."),

  // Phase 12 — Elasticsearch (optional).
  // If set, tickets/comments are indexed on write and the search route uses
  // ES instead of Postgres ILIKE.
  ELASTICSEARCH_URL: optionalString,
  ELASTICSEARCH_API_KEY: optionalString,
  ELASTICSEARCH_INDEX_PREFIX: z.string().default("relay"),

  // Phase 13 — workflow executor tick (minutes). Minimum useful is 1.
  WORKFLOW_TICK_MINUTES: z.coerce.number().int().positive().default(1),

  // Phase 14 — infrastructure-action credentials. All optional — a runbook
  // returns FAILED with a "missing config" reason if it tries to run without
  // its credentials present.
  //
  // The runbooks shell out to local CLIs (terraform, ansible-playbook) for
  // IaC, and call vendor REST APIs for firewall + ITSM.
  TERRAFORM_BIN: z.string().default("terraform"),
  ANSIBLE_BIN:   z.string().default("ansible-playbook"),
  // Default working dir for terraform when an org hasn't set its own. Useful
  // for the demo / single-tenant deployments.
  TERRAFORM_DEFAULT_WORKDIR: optionalString,
  // Vendor-neutral firewall API token (PaloAlto PAN-OS, pfSense, etc.).
  FIREWALL_API_TOKEN: optionalString,
  // ITSM bridges — write-only push from Relay → external system.
  SERVICENOW_API_TOKEN: optionalString,
  JIRA_API_TOKEN: optionalString,

  // Phase 15 — Structured logging + telemetry exporters.
  // The default sink is stdout. Adding env activates additional sinks
  // (each fans out best-effort; failures don't break the request).
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // ELK — server logs (separate from the Phase-12 ticket/event indexing).
  // The same ES cluster, just a different index pattern.
  ELASTICSEARCH_LOGS_PREFIX: z.string().default("relay-logs"),

  // Splunk HTTP Event Collector. Just URL + token; works against any
  // Splunk Cloud / Enterprise instance with HEC enabled.
  SPLUNK_HEC_URL: optionalString,
  SPLUNK_HEC_TOKEN: optionalString,
  SPLUNK_HEC_INDEX: optionalString, // optional; HEC picks the default

  // CloudWatch — Logs + Metrics. AWS creds come from the default SDK
  // chain (env / ~/.aws / IMDS / etc.).
  CLOUDWATCH_LOG_GROUP: optionalString,
  CLOUDWATCH_LOG_STREAM: z.string().default("relay-server"),
  CLOUDWATCH_METRICS_NAMESPACE: optionalString,
  CLOUDWATCH_METRICS_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  AWS_REGION: z.string().default("us-east-1"),

  // Azure Monitor Data Collector API.
  AZURE_MONITOR_WORKSPACE_ID: optionalString,
  AZURE_MONITOR_SHARED_KEY: optionalString,
  AZURE_MONITOR_LOG_TYPE: z.string().default("RelayServer"),

  // Phase 16 — ML training cron. Default once daily at 03:00 UTC.
  ML_TRAIN_CRON: z.string().default("0 3 * * *"),

  // Phase 20 — model family override.
  //   "auto"     — GBT when ≥50 per-attempt rows exist, else logistic
  //   "gbt"      — always train gradient-boosted decision stumps
  //   "logistic" — always train logistic regression
  ML_FAMILY: z.enum(["auto", "gbt", "logistic"]).default("auto"),

  // Phase 20 — optional Python ML sidecar. When set, predict() calls a
  // FastAPI/sklearn service over HTTP instead of running the in-process
  // model. See deploy/ml-sidecar/ for the reference implementation.
  ML_SIDECAR_URL: optionalString,

  // Phase 17 — Open Policy Agent.
  // When set, the policy engine also consults OPA's `/v1/data/relay/allow`
  // endpoint. OPA can only ADD denials on top of the built-in TS policies —
  // it cannot override a built-in DENY (defense in depth).
  OPA_URL: optionalString,
  // Decision document path; defaults to "relay/allow".
  OPA_DECISION_PATH: z.string().default("relay/allow"),

  // Phase 25 — Threat intelligence.
  THREAT_INTEL_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  THREAT_INTEL_RSS_FEEDS: z.string().default([
    "https://feeds.feedburner.com/TheHackersNews",
    "https://www.bleepingcomputer.com/feed/",
    "https://krebsonsecurity.com/feed/",
  ].join(",")),
  NVD_API_KEY: optionalString,
  CISA_KEV_URL: z.string().default("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"),
  NVD_API_BASE: z.string().default("https://services.nvd.nist.gov/rest/json"),
  NVD_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  // Auto-create tickets for HIGH/CRITICAL matches against your fleet.
  THREAT_INTEL_AUTO_TICKET: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase() === "true" : Boolean(v)),
    z.boolean(),
  ).default(true),

  // ─── Phase 26 — Commercial threat-intel feeds ──────────────────────
  // Each source is env-gated. Without keys, the adapter returns [] and
  // the engine logs "source skipped — no credentials".

  // Mandiant (Google Cloud Threat Intelligence) — API v4
  //   GET https://api.intelligence.mandiant.com/v4/vulnerability?...
  // Auth: POST /token with HTTP Basic ${KEY}:${SECRET} → bearer (rotate ~30 min).
  MANDIANT_API_KEY:    optionalString,
  MANDIANT_API_SECRET: optionalString,
  MANDIANT_API_BASE:   z.string().default("https://api.intelligence.mandiant.com"),
  // Minimum Mandiant "mscore" confidence to ingest (0-100). Default 70.
  MANDIANT_MIN_MSCORE: z.coerce.number().int().min(0).max(100).default(70),

  // Recorded Future
  // Auth: X-RFToken header.
  RECORDED_FUTURE_API_KEY: optionalString,
  RECORDED_FUTURE_API_BASE: z.string().default("https://api.recordedfuture.com"),
  RECORDED_FUTURE_MIN_RISK: z.coerce.number().int().min(0).max(99).default(70),

  // CrowdStrike Falcon Intelligence
  // Auth: OAuth2 client_credentials grant → bearer.
  CROWDSTRIKE_CLIENT_ID:     optionalString,
  CROWDSTRIKE_CLIENT_SECRET: optionalString,
  CROWDSTRIKE_API_BASE:      z.string().default("https://api.crowdstrike.com"),

  // ─── Phase 26 — Daily agentic defender ──────────────────────────────
  // Cron — default 06:00 UTC so the defender runs before the 08:00 brief.
  DEFENDER_CRON: z.string().default("0 6 * * *"),
  // Hard cap on Claude tool-use iterations per defender run.
  DEFENDER_MAX_ITERATIONS: z.coerce.number().int().positive().default(20),

  // ─── Phase 27 — Behavioural detection (MITRE + Wazuh + AI rules) ───
  // MITRE ATT&CK enterprise STIX feed — pulled weekly (Sundays 04:00 UTC).
  MITRE_ATTACK_URL: z.string().default(
    "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json",
  ),
  MITRE_ATTACK_REFRESH_CRON: z.string().default("0 4 * * 0"),

  // Wazuh manager — REST API base + auth.
  // Wazuh requires a JWT exchange: POST /security/user/authenticate (Basic) → token.
  WAZUH_API_URL:      optionalString,
  WAZUH_API_USER:     optionalString,
  WAZUH_API_PASSWORD: optionalString,
  WAZUH_POLL_MINUTES: z.coerce.number().int().positive().default(1),
  WAZUH_DEFAULT_ORG_SLUG: optionalString,

  // Daily AI-rule study session — runs as part of the defender at 06:00 UTC.
  AI_RULE_STUDY_ENABLED: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase() === "true" : Boolean(v)),
    z.boolean(),
  ).default(true),
  // Cap on how many new rules the AI can DRAFT per session.
  AI_RULE_STUDY_MAX_DRAFTS: z.coerce.number().int().positive().default(5),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

export const oauthEnabled = {
  google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
};
