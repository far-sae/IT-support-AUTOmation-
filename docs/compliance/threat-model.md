# Relay — threat model (STRIDE)

A STRIDE-style threat model for the major architectural surfaces. For each
threat we list the realistic attack scenarios, what mitigates them today,
and what doesn't.

## Surfaces in scope

1. **Browser → API (HTTPS)** — the React SPA calls `/api/*`
2. **Inbound email (IMAP)** — tickets created from emails
3. **Agent endpoint** — desktop agent posts metrics + receives actions
4. **Outbound integrations** — Slack / GitHub / firewall / ITSM
5. **Internal DB connection** — server ↔ Postgres
6. **Background jobs** — cron-driven (autopilot, brief, detection, ML)

---

## Surface 1 — Browser → API

| STRIDE | Threat | Mitigation | Gap |
|---|---|---|---|
| **S**poofing | Attacker impersonates a logged-in user | JWT bearer + bcrypt password hashing | No HSTS preload in code (ingress's job) |
| **T**ampering | Attacker modifies request body in flight | TLS at ingress | None |
| **R**epudiation | User denies an action they took | Every state change writes an audit row keyed by `userId` | Audit log isn't tamper-evident (no hash chain) |
| **I**nformation disclosure | One tenant reads another tenant's data | Prisma extension auto-filters every query by `organizationId` from ALS | `basePrismaUnscoped` escape hatch — code review must flag |
| **D**oS | Attacker floods the API | None at app layer | Add `express-rate-limit` |
| **E**levation | Employee gains AGENT/ADMIN powers | `requireRole()` gates on every privileged route | None |

## Surface 2 — Inbound email (IMAP)

| STRIDE | Threat | Mitigation | Gap |
|---|---|---|---|
| **S**poofing | Spoofed sender opens a ticket | Email FROM is captured as `submitterEmail`; we don't action it without further verification | SPF/DKIM/DMARC checks not implemented |
| **T**ampering | Email body tampered en route | IMAP over TLS | None |
| **R**epudiation | Submitter denies sending | Original `Message-ID` stored | None |
| **I**nformation disclosure | Inbound mail contains PHI / secrets | Treated like every ticket; tenant-scoped storage; access via role | No PHI redaction in logs |
| **D**oS | Attacker spams the inbox | None at app layer | IMAP-provider rate limits + bounce filtering should be configured upstream |
| **E**levation | Email auto-routes to ADMIN view | Inbound emails get role-less submitter status; ADMIN read is governed by role | None |

## Surface 3 — Agent endpoint

The desktop agent authenticates via an enrollment token (`AgentEnrollmentToken`).

| STRIDE | Threat | Mitigation | Gap |
|---|---|---|---|
| **S**poofing | Attacker has a stolen agent token | Token is hashed in the DB + scoped to one org; revocable via admin route | Tokens don't expire automatically (recommended: add `expiresAt`) |
| **T**ampering | Attacker forges device metrics | Token alone authenticates — no per-device key | Recommend issuing a per-device cert at enrollment, server pins the public key |
| **R**epudiation | Device denies an action | Every `AgentAction` row is keyed by `deviceId` + has `dispatchedAt` / `completedAt` | None |
| **I**nformation disclosure | Metrics leak between orgs | Token is org-scoped — agent can only POST against its own org | None |
| **D**oS | Agent floods the metrics endpoint | No rate limit in code | Add per-token rate limit |
| **E**levation | Agent dispatches to other devices | An `AgentAction` carries an explicit `deviceId`; the agent route only returns actions for its own enrolled device | None |

## Surface 4 — Outbound integrations

The server makes HTTPS calls to Slack, GitHub, PaloAlto, ServiceNow, Jira,
Splunk, Azure Monitor, OPA.

| STRIDE | Threat | Mitigation | Gap |
|---|---|---|---|
| **S**poofing | Attacker sets a malicious destination URL via `Organization.settings` | Requires ADMIN role | **SSRF risk** — see OWASP A10. Add `safeFetch()` deny-list for RFC1918 |
| **T**ampering | MITM on outbound HTTPS | TLS everywhere; Azure Monitor uses HMAC over body+headers | None |
| **R**epudiation | Vendor denies receiving | We log every response (status + body excerpt) on `RunbookExecution.decision` | None |
| **I**nformation disclosure | Ticket data leaks to wrong vendor | Org admin controls the destination URL | If admin is compromised: full data leak. Mitigation = secret-manager pattern |
| **D**oS | Vendor is the attacker (3rd-party compromise) | Each integration has a 10-min timeout + capped output | None |

## Surface 5 — Internal DB

| STRIDE | Threat | Mitigation | Gap |
|---|---|---|---|
| **S**poofing | Attacker presents fake DB credentials | DB credentials live in Secrets, never in config | None |
| **T**ampering | Attacker modifies data in flight server ↔ DB | TLS between server pod + DB pod in K8s NetworkPolicy | Postgres TLS verification not enforced (should set `sslmode=verify-full`) |
| **R**epudiation | DBA denies a change | DB-level audit (pgaudit) is operational, not in this repo | Document the DBA process externally |
| **I**nformation disclosure | DB backup leaks PHI | Backup encryption is the storage layer's responsibility | Document KMS key policy externally |
| **D**oS | Attacker exhausts connections | Prisma's connection pool defaults | Tune pool size per replica count |
| **E**levation | App escalates via Postgres role | App connects as a non-superuser; migrations need an elevated role separately | Document the role split |

## Surface 6 — Background jobs

Autopilot, daily brief, detection, ML training, workflow advancer.

| STRIDE | Threat | Mitigation | Gap |
|---|---|---|---|
| **S**poofing | N/A — no inbound auth |  |  |
| **T**ampering | Attacker plants malicious cron payload | All crons are code-defined, not data-driven | None |
| **R**epudiation | Background action denied | Every action writes audit row | None |
| **I**nformation disclosure | Cron logs leak PHI to external sinks | Structured logger redacts known PHI fields by name | **Gap**: regex-based PHI redaction (SSN, MRN) not in place. Recommend adding |
| **D**oS | One tenant's cron blocks others | `runWithTenant` is per-org; one slow org doesn't block the cron loop | Cron loop is single-threaded; large fleets should partition by org |
| **E**levation | Cron uses platform mode | `platformMode` is set by the cron only when it explicitly needs cross-org access | Code review must verify each cron entry point |

---

## Top 5 highest-risk gaps to address before going to production

1. **Add `safeFetch()` SSRF guard** for all integrations. (~30 LOC)
2. **Enforce MFA via middleware** — schema slot exists, route check doesn't. (~50 LOC)
3. **Add login rate-limiting** with `express-rate-limit`. (~10 LOC)
4. **Add PHI redaction** to the structured logger before shipping to external sinks. (~30 LOC + regex dict)
5. **Move vendor tokens to a secret manager** — Vault / AWS SM / Azure KV.
