# HIPAA technical safeguards — mapping to Relay code

**Scope:** HIPAA Security Rule, §164.312 (Technical Safeguards). The
administrative and physical safeguards (§164.308 and §164.310) are
organisation-level and out of scope of this codebase.

**Caveat:** Relay isn't a clinical or claims platform. It's an IT-support
automation tool. If you deploy it inside a covered entity (a hospital,
insurer, BAA-bound vendor), the helpdesk tickets will contain PHI by
accident (patient names mentioned in a "my login broke" ticket, scheduling
data in incident notes, etc.). This document treats the entire ticket
content as if it could include PHI and protects accordingly.

---

## §164.312(a)(1) — Access Control

### (i) Unique user identification (Required)

- Every user has a per-tenant unique `(organizationId, email)` pair
  enforced at the schema level
- Evidence: [server/prisma/schema.prisma](../../server/prisma/schema.prisma) — `User` model
  with `@@unique([organizationId, email])`

### (ii) Emergency access procedure (Required)

- Platform-admin role (`isPlatformAdmin = true`) can opt into cross-org
  access via `platformMode`. Every such access is logged
- Evidence: [server/src/auth/middleware.ts](../../server/src/auth/middleware.ts), [server/src/tenant/context.ts](../../server/src/tenant/context.ts)

### (iii) Automatic logoff (Addressable)

- JWT expires per `JWT_EXPIRES_IN` (default `7d`). Client-side inactivity
  logoff is **not yet implemented** — this is an addressable gap. Suggested
  remediation: add a sliding inactivity timer in `client/src/auth/AuthProvider.tsx`
- Evidence: [server/src/auth/passport.ts](../../server/src/auth/passport.ts), [server/src/env.ts](../../server/src/env.ts)

### (iv) Encryption + decryption (Addressable)

- All data at rest in Postgres + S3 (encryption is the storage layer's
  responsibility — configure RDS / Cloud SQL / RDS encryption-at-rest +
  KMS managed keys)
- All data in transit: TLS via the ingress (cert-manager in [deploy/k8s/ingress.yaml](../../deploy/k8s/ingress.yaml))
- Sensitive fields (passwords) hashed with bcrypt
- Evidence: [server/src/auth/passport.ts](../../server/src/auth/passport.ts) — bcrypt cost factor 12

## §164.312(b) — Audit controls

- Every state-changing API call writes a row to one of:
  `RunbookExecution`, `WorkflowExecution`, `AgentAction`, `Comment` (internal note)
- Every ML training run writes an `MlModel` row with `trainedAt` + metrics
- Every detection firing writes a `DetectionHit` row
- Logs are JSON-structured and shipped to ELK / Splunk / CloudWatch when
  configured: [server/src/observability/logger.ts](../../server/src/observability/logger.ts)
- Evidence: [server/prisma/schema.prisma](../../server/prisma/schema.prisma)

## §164.312(c)(1) — Integrity

### (i) Mechanism to authenticate ePHI

- Every protected row is tenant-scoped via Prisma extension; manual
  override requires `platformMode: true` set in code
- Evidence: [server/src/db.ts](../../server/src/db.ts) `TENANT_SCOPED_MODELS`
- Database constraints prevent orphan rows (cascade on
  `Organization.delete`); foreign keys are NOT NULL on every
  `organizationId` column
- Evidence: 16 migrations in [server/prisma/migrations/](../../server/prisma/migrations/)

## §164.312(d) — Person or entity authentication

- Three auth modes: local password (bcrypt), Google OAuth, Microsoft OAuth
- MFA support: tracked in `User.mfaEnabled` — **schema slot exists; the
  enforcement middleware is not yet wired** (gap)
- Evidence: [server/src/auth/passport.ts](../../server/src/auth/passport.ts)

## §164.312(e)(1) — Transmission security

### (i) Integrity controls

- TLS for every external interface
- Webhooks (Slack / GitHub / etc.) use HTTPS only — see env validation
  rejecting non-HTTPS URLs in [server/src/env.ts](../../server/src/env.ts)

### (ii) Encryption (Addressable)

- TLS for all in-transit traffic
- HMAC-SHA256 signed payloads to Azure Monitor: see
  [server/src/observability/sinks/azure_monitor.ts](../../server/src/observability/sinks/azure_monitor.ts)
- Splunk HEC uses TLS + token auth
- Kafka in production should use SASL/SSL — our adapter accepts that via
  the `KAFKA_BROKERS` env (use a `SASL_SSL` URI prefix)

---

## Gaps a healthcare deployment must close before going live

1. **MFA enforcement middleware** — schema is ready, server-side check is
   not. Recommendation: add a `requireMfa` middleware applied to every
   non-auth route + a session-elevation flow.
2. **Inactivity auto-logoff** on the client — `client/src/auth/`.
3. **PHI redaction in logs** — the structured logger writes ticket
   descriptions verbatim. A real deployment should add a redactor pass
   (e.g. presidio) before shipping logs off-cluster.
4. **Field-level encryption** for known-PHI columns (e.g. `Ticket.description`)
   — Postgres column-level encryption with pgcrypto, or app-side AES-GCM
   with KMS-derived keys.
5. **BAA + DPA chain** — every sub-processor must have a BAA. Slack, Splunk,
   ES, Kafka, AWS, Azure all support BAAs; verify your contracts.
