/**
 * Typed view of Organization.settings (which is stored as JSON in Postgres).
 * Keeping the shape in one place lets the rest of the app trust it.
 */

export interface OrgSettings {
  branding?: {
    primaryColor?: string;
    logoUrl?: string;
  };
  slaOverrides?: {
    // Override the default per-priority SLA windows. Keys map to Priority,
    // values are duration strings ("1 hour", "4 hours", "1 business day"…).
    Critical?: string;
    High?: string;
    Medium?: string;
    Low?: string;
  };
  // Allowed email domains for SSO auto-join (future use; not enforced yet).
  allowedDomains?: string[];
  // Phase 10A — per-tenant kill switch for the runbook engine.
  // Each entry is a Runbook.key (see server/src/runbooks/registry.ts).
  disabledRunbooks?: string[];
  // Phase 10B — autopilot policy.
  //   FULL_AUTO            — brain executes any matched runbook (incl. MEDIUM)
  //                          and verifies via timer + reply detection. Default.
  //   REVIEW_MEDIUM_HIGH   — LOW runs auto, MEDIUM/HIGH pause for an agent to approve
  //   HUMAN_IN_LOOP        — every runbook pauses; agent must approve each one
  autonomy?: "FULL_AUTO" | "REVIEW_MEDIUM_HIGH" | "HUMAN_IN_LOOP";
  // How many minutes the verification timer waits before assuming the
  // runbook fixed the issue (no negative reply received). Default 60.
  verificationMinutes?: number;
  // Phase 11 — per-tenant kill switch for policies (keys from policies/registry.ts).
  disabledPolicies?: string[];
  // Phase 11 — Slack webhook URL for the daily brief + escalations.
  slackWebhookUrl?: string;
  // Phase 11 — daily brief schedule (cron expression, default "0 8 * * *" — 08:00 UTC).
  briefSchedule?: string;
  // Phase 11 — GitHub repo (owner/repo) used by github_dispatch runbook
  // and co-pilot manual trigger. Token comes from env.
  githubRepo?: string;
  // Phase 11 — business-hours window the policy engine consults.
  // Defaults: Mon–Fri, 09:00–18:00, UTC.
  businessHours?: { tz?: string; daysOfWeek?: number[]; startHour?: number; endHour?: number };
  // Phase 12 — detection rule kill switch (keys from detect/registry.ts).
  disabledDetectionRules?: string[];

  // Phase 14 — Infrastructure action targets. Credentials come from env;
  // this stores the *what* (workspace paths, playbook names, base URLs).
  terraformWorkspaces?: Array<{
    /** Short id used by the runbook to pick which workspace to apply. */
    key: string;
    /** Absolute path on the server host that holds the Terraform config. */
    path: string;
    /** Optional -var=k=v entries passed to apply. */
    vars?: Record<string, string>;
  }>;
  ansiblePlaybooks?: Array<{
    key: string;
    /** Absolute path to the .yml playbook. */
    path: string;
    /** Inventory file path or comma-separated host list. */
    inventory: string;
    /** Extra -e key=value pairs. */
    extraVars?: Record<string, string>;
  }>;
  firewall?: {
    vendor: "palo_alto" | "pfsense" | "generic";
    baseUrl: string;
    /** Default block-list (PaloAlto: external dynamic list / pfSense: alias). */
    blockList?: string;
  };
  itsm?: {
    serviceNow?: {
      instance: string;   // e.g. "https://acme.service-now.com"
      user: string;       // basic-auth username; token comes from env
      defaultTable?: string;  // default "incident"
    };
    jira?: {
      baseUrl: string;    // "https://acme.atlassian.net"
      project: string;    // "OPS"
      user: string;       // email
      issueType?: string;  // default "Task"
    };
  };
}

export function parseOrgSettings(json: unknown): OrgSettings {
  if (!json || typeof json !== "object") return {};
  return json as OrgSettings;
}
