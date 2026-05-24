# SOC2 controls — mapping to Relay code + process

**Scope of this document:** Trust Services Criteria (TSC) 2017, focused on
the Security and Confidentiality categories. The Availability and Processing
Integrity criteria are addressed inline where they overlap.

**Reading guide for an auditor:** every row's "Evidence" column is a path
relative to the repo root. Clicking it in a real auditor walk-through opens
the actual code that implements the control.

---

## CC1 — Control Environment

| Control | Status | Evidence |
|---|---|---|
| CC1.1 — Code of conduct | ⚠ Org-policy doc needed (out of scope of this codebase) |  |
| CC1.4 — Trained personnel | ⚠ Document each engineer's training in HR | — |

## CC2 — Communication and Information

| Control | Status | Evidence |
|---|---|---|
| CC2.2 — Internal communication of security objectives | ✓ | [README.md](../../README.md), [docs/compliance/](.) folder published in source control |
| CC2.3 — External communication of security | ⚠ Public security.txt + responsible-disclosure policy needed | — |

## CC3 — Risk Assessment

| Control | Status | Evidence |
|---|---|---|
| CC3.1 — Risk identification | ✓ | [threat-model.md](threat-model.md) |
| CC3.2 — Risk responses | ✓ | Policy engine: [server/src/policies/](../../server/src/policies/) |
| CC3.4 — Significant change risk | ⚠ Change-management process needed (CR/CAB) | — |

## CC4 — Monitoring Activities

| Control | Status | Evidence |
|---|---|---|
| CC4.1 — Continuous monitoring | ✓ | Prometheus metrics: [server/src/observability/metrics.ts](../../server/src/observability/metrics.ts), Grafana dashboard provisioned in [docker/grafana/](../../docker/grafana/) |
| CC4.2 — Independent monitoring | ✓ | External log shipping (Splunk/ES/CloudWatch/Azure): [server/src/observability/sinks/](../../server/src/observability/sinks/) |

## CC5 — Control Activities

| Control | Status | Evidence |
|---|---|---|
| CC5.1 — Policies + procedures | ✓ | This document + ADRs in [docs/adr/](../adr/) |
| CC5.2 — Technology-supported controls | ✓ | Policy engine: [server/src/policies/engine.ts](../../server/src/policies/engine.ts) |

## CC6 — Logical and Physical Access

| Control | Status | Evidence |
|---|---|---|
| CC6.1 — Logical access controls | ✓ | JWT auth: [server/src/auth/](../../server/src/auth/); role-based access: `requireRole()` in [server/src/auth/middleware.ts](../../server/src/auth/middleware.ts) |
| CC6.2 — New access provisioning | ✓ | Org-invite flow: [server/src/routes/invites.ts](../../server/src/routes/invites.ts); admin-only `requireRole(Role.ADMIN)` |
| CC6.3 — Access removal | ✓ | `User.suspendedAt` + offboarding workflow: [server/src/workflows/builtins-identity.ts](../../server/src/workflows/builtins-identity.ts) |
| CC6.6 — Logical access for users | ✓ | Tenant isolation via Prisma extension: [server/src/db.ts](../../server/src/db.ts) — every query auto-filtered by `organizationId` |
| CC6.7 — Restriction of access to information | ✓ | Same as CC6.6; also platform-admin opt-in via `platformMode` flag |
| CC6.8 — Detection + prevention of unauthorized access | ✓ | Detection rules: [server/src/detect/](../../server/src/detect/) (5 identity-related rules at HIGH severity) |

## CC7 — System Operations

| Control | Status | Evidence |
|---|---|---|
| CC7.1 — Vulnerability management | ⚠ Dependabot / Renovate not configured | — |
| CC7.2 — Incident detection + response | ✓ | Detection engine + `incident_response` workflow: [server/src/workflows/builtins-security.ts](../../server/src/workflows/builtins-security.ts) |
| CC7.3 — Recovery from incidents | ✓ | Compensation framework in workflow engine: [server/src/workflows/engine.ts](../../server/src/workflows/engine.ts) `advanceCompensation()` |
| CC7.4 — Incident communication | ✓ | Slack + email notifiers: [server/src/notifications/slack.ts](../../server/src/notifications/slack.ts), [server/src/email/mailer.ts](../../server/src/email/mailer.ts) |
| CC7.5 — Backup + recovery | ⚠ Database-level backup process needs operational documentation per environment | `backup_verification` workflow exists: [server/src/workflows/builtins-fleet.ts](../../server/src/workflows/builtins-fleet.ts) |

## CC8 — Change Management

| Control | Status | Evidence |
|---|---|---|
| CC8.1 — Authorized changes | ✓ | Git + branch protection (operational); ADRs: [docs/adr/](../adr/) |

## CC9 — Risk Mitigation

| Control | Status | Evidence |
|---|---|---|
| CC9.1 — Risk responses | ✓ | Policy engine + risk scoring: [server/src/policies/risk.ts](../../server/src/policies/risk.ts) |
| CC9.2 — Vendor + business-partner risk | ⚠ Vendor inventory + DPAs to be maintained externally | — |

---

## Availability (A1)

| Control | Status | Evidence |
|---|---|---|
| A1.1 — Performance + capacity | ✓ | HPA in K8s deploy: [deploy/k8s/server.yaml](../../deploy/k8s/server.yaml); load tests: [load/](../../load/) |
| A1.2 — Environmental protection | ✓ | Health checks: `/healthz` endpoint; PDB in K8s |
| A1.3 — Disaster recovery testing | ⚠ DR drill schedule must be operational | `backup_verification` workflow available |

## Processing Integrity (PI1)

| Control | Status | Evidence |
|---|---|---|
| PI1.1 — Definition of valid + accurate data | ✓ | Zod input validation across every route: [server/src/routes/](../../server/src/routes/) |
| PI1.2 — Inputs validated | ✓ | Same as PI1.1 |
| PI1.3 — Errors detected + reported | ✓ | Centralized error handler: [server/src/errors.ts](../../server/src/errors.ts) |
| PI1.4 — Output reviewed | ✓ | Audit trails on every `RunbookExecution`, `WorkflowExecution`, `AgentAction`, `Comment` |

## Confidentiality (C1)

| Control | Status | Evidence |
|---|---|---|
| C1.1 — Confidentiality category definition | ⚠ Data-classification policy needs an org-level doc | — |
| C1.2 — Confidential information disposal | ⚠ Retention + erasure schedules per data class | Cascade-delete on `Organization` removal ensures complete erasure |

---

## Auditor walk-through checklist

Use this for the actual interview:

- [ ] Walk one ADR end-to-end (pick one with a security implication)
- [ ] Show the Prisma tenancy extension live — open a tenant-A session, try
      to read a tenant-B ticket, confirm a 404
- [ ] Show one passing integration test (e.g.
      `server/src/integrations/__test__/itsm.integration.test.ts`)
- [ ] Show the policy engine refusing a HIGH-risk action — file a
      `terraform_apply` ticket, watch it get `AWAITING_AGENT`
- [ ] Show the detection feed — open `/detections`, confirm rules are live
- [ ] Show audit comments on a closed ticket — autopilot's internal notes
- [ ] Show Slack / Splunk / CloudWatch sink configs in env (redacted)
- [ ] Show migration history in `server/prisma/migrations/`
- [ ] Show `/metrics` exposition + Grafana dashboard
