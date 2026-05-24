# OWASP Top 10 (2021) — review of the Relay codebase

A code-level review against each of the OWASP Top 10 categories. Each
section names the threat, what the codebase does about it, where to find
the evidence, and any residual gaps.

**Reviewer:** internal (single engineer). **Recommendation:** an external
pen-test should follow before any enterprise sale.

---

## A01:2021 — Broken Access Control

**Status:** ✓ multi-layer defence

Implementation:
- JWT bearer auth on every protected route via `requireAuth` middleware
- Role-based gates via `requireRole(Role.ADMIN | Role.AGENT)`
- **Tenant isolation as a database-layer invariant** — every query against
  a tenant-scoped model is filtered by `organizationId` from
  AsyncLocalStorage, regardless of what the route wrote. A missed
  `where: { organizationId }` cannot leak cross-tenant data
- Evidence:
  - [server/src/auth/middleware.ts](../../server/src/auth/middleware.ts)
  - [server/src/db.ts](../../server/src/db.ts) Prisma `$extends({ query: ... })`
  - [server/src/tenant/isolation.test.ts](../../server/src/tenant/isolation.test.ts) — explicit cross-tenant leak tests

**Residual risk:** the `basePrismaUnscoped` escape hatch. Code review must
flag any use of it outside the documented call sites (auth pre-context).

## A02:2021 — Cryptographic Failures

**Status:** ✓ for in-app crypto; ⚠ for at-rest encryption (storage-layer responsibility)

- Passwords: bcrypt cost 12 ([server/src/auth/passport.ts](../../server/src/auth/passport.ts))
- JWT secret: required min 16 chars, rejected at startup if missing/short
  ([server/src/env.ts](../../server/src/env.ts))
- Azure Monitor: HMAC-SHA256 signed payloads using
  `node:crypto` ([server/src/observability/sinks/azure_monitor.ts](../../server/src/observability/sinks/azure_monitor.ts))
- TLS for all external interfaces is the ingress's job; we don't terminate TLS
  in-app

**Residual risk:** Postgres at-rest encryption is deferred to the managed
DB (RDS / Cloud SQL); this must be enforced via infrastructure-as-code.

## A03:2021 — Injection

**Status:** ✓

- All DB access via Prisma ORM (parameterised) — no raw SQL anywhere
- All API inputs validated with Zod ([server/src/routes/](../../server/src/routes/))
- HTML output in client uses React's default escaping; the one
  `dangerouslySetInnerHTML` call (the Markdown brief widget) takes input
  only from autopilot-generated content, not user input
- Evidence: see [client/src/pages/DailyBriefCard.tsx](../../client/src/pages/DailyBriefCard.tsx) — the
  `renderMarkdown` helper HTML-escapes &lt;/&gt;/& before transforming markdown

**Residual risk:** the Anthropic-generated daily-brief text is rendered as
HTML. The escape function is conservative but a malicious model output
could in theory craft text that survives. Defence-in-depth would be a
CSP header (already set via the ingress in production).

## A04:2021 — Insecure Design

**Status:** ✓ for the autopilot threat model; ⚠ for the secret-storage threat model

- Policy engine forces an "agent must approve" gate on any HIGH-risk action,
  with multiple independent guards (built-in TS policies + OPA)
- Risk score is computed transparently per action; reasons are stored on
  the audit log
- Tenant isolation is enforced at three layers (route, ALS context, DB
  extension)

**Residual gap:** vendor API tokens (Splunk, Slack, etc.) live in
environment variables read at startup. For production, integrate with
HashiCorp Vault / AWS Secrets Manager / Azure Key Vault — the env
variables become the indirection point.

## A05:2021 — Security Misconfiguration

**Status:** ✓

- Helmet headers + CORS configured via Express
- Production Docker images run as non-root user (uid 1000)
  ([deploy/k8s/server.yaml](../../deploy/k8s/server.yaml))
- Default-deny NetworkPolicy in K8s
  ([deploy/k8s/networkpolicy.yaml](../../deploy/k8s/networkpolicy.yaml))
- Pod security: `runAsNonRoot`, `allowPrivilegeEscalation: false`,
  `capabilities: drop ALL`
- Startup validation rejects misconfigured env (Zod schema)

## A06:2021 — Vulnerable + Outdated Components

**Status:** ⚠ partial

- All dependencies pinned to caret versions in package.json (allows minor
  bumps but not major)
- **Gap:** no Dependabot / Renovate; no automated SBOM. Recommendation:
  enable Dependabot security updates on the GitHub repo, generate SBOM
  with `npm sbom` + Syft.

## A07:2021 — Identification + Authentication Failures

**Status:** ✓

- Login attempt rate limiting? Not implemented — gap (recommend
  `express-rate-limit` on `/api/auth/login`)
- Password complexity: enforced at registration (min 8 chars + zod)
- Session management via JWT with explicit expiry; no session fixation
  vector

## A08:2021 — Software + Data Integrity Failures

**Status:** ✓

- Every state-changing action writes an audit row
- Workflow engine is Postgres-durable — every step transition is one
  transaction; a crash mid-step doesn't leave inconsistent state
- Compensation framework rolls completed steps back when a later step
  fails

## A09:2021 — Security Logging + Monitoring Failures

**Status:** ✓ at the code level

- Structured JSON logger fan-out to multiple sinks
  ([server/src/observability/logger.ts](../../server/src/observability/logger.ts))
- Detection rules surface anomalies as `DetectionHit` rows with Slack
  notification + Prometheus counter
- Every auth event, policy denial, runbook execution, agent action, and
  detection hit is logged

**Residual gap:** alert routing (PagerDuty / Opsgenie) isn't wired —
detections only fire Slack today. Recommendation: add a PagerDuty
adapter sink in `server/src/observability/sinks/` for CRITICAL detections.

## A10:2021 — Server-Side Request Forgery (SSRF)

**Status:** ⚠ assess per integration

We make outbound HTTP from the server in many places:
- Slack webhooks
- GitHub Actions dispatch
- Firewall API (PaloAlto / pfSense / generic)
- ITSM (ServiceNow / Jira)
- OPA
- Splunk / Azure Monitor

For each, the destination URL is **org-configured** (in `Organization.settings`).
A malicious admin could in theory set those URLs to internal endpoints
(SSRF) — but the bar is "admin" + the resulting request body is rigidly
shaped (no arbitrary path traversal).

**Recommendation:** add an allow-list / deny-list for destination IP
ranges (no RFC1918 by default; configurable). Implement in a single
`safeFetch()` wrapper used by every integration.

---

## Summary

| Category | Status | Headline gap |
|---|---|---|
| A01 Broken access control | ✓ | Audit `basePrismaUnscoped` usage in code review |
| A02 Crypto | ✓ | At-rest encryption is infrastructure's job |
| A03 Injection | ✓ | None |
| A04 Insecure design | ✓ / ⚠ | Move vendor tokens to a secret manager |
| A05 Misconfiguration | ✓ | None |
| A06 Vulnerable components | ⚠ | Enable Dependabot |
| A07 Auth failures | ✓ / ⚠ | Add login rate-limit |
| A08 Integrity | ✓ | None |
| A09 Logging/monitoring | ✓ | Add PagerDuty for CRITICAL |
| A10 SSRF | ⚠ | Add `safeFetch()` deny-list |
