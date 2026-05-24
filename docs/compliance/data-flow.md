# Relay — data flow diagram

The high-level data flow from inbound ticket → outbound action. Use this
as the answer to an auditor's "what happens when a ticket lands?" question.

```mermaid
flowchart TB
  subgraph Inbound
    A1[Web portal — ticket form]
    A2[IMAP — inbound email]
  end

  subgraph "API layer (Express, multi-tenant)"
    B1[POST /api/tickets]
    B2[Auth + Zod validation]
    B3[Tenant ALS context]
  end

  subgraph "Triage + brain"
    C1[Triage classifier — Anthropic OR rules]
    C2[Brain — runbook + workflow pick]
    C3[Policy engine + risk score]
    C4[ML predict — GBT or logistic]
  end

  subgraph "Storage (Postgres)"
    D1[(Ticket)]
    D2[(RunbookExecution)]
    D3[(AgentAction)]
    D4[(WorkflowExecution)]
    D5[(RemediationAttempt — for ML)]
    D6[(TicketEmbedding — memory)]
    D7[(DetectionHit)]
  end

  subgraph "Outbound — best-effort"
    E1[Slack — incidents + brief]
    E2[Email — replies + survey]
    E3[GitHub Actions]
    E4[Firewall API]
    E5[ServiceNow / Jira]
    E6[Splunk / CloudWatch / Azure Monitor]
    E7[Kafka — event mirror]
    E8[Elasticsearch — search + log shipping]
  end

  subgraph "Background"
    F1[Autopilot cron 1m]
    F2[Detection cron 5m]
    F3[Workflow advancer 1m]
    F4[ML trainer 24h]
    F5[Daily brief cron 24h]
    F6[SLA scanner 5m]
  end

  A1 --> B1
  A2 --> B1
  B1 --> B2 --> B3 --> D1
  D1 --> C1 --> C2 --> C3 --> C4
  C2 --> D2 & D3 & D4
  C4 --> D5
  D1 -. on resolve .-> D6

  F1 --> C2
  F2 --> D7
  F3 --> D4
  F4 --> D5
  F5 --> E1 & E2
  F6 --> E1

  C2 --> E1 & E2 & E3 & E4 & E5
  B1 --> E7 & E8
  D2 --> E6
```

## Data classification

| Data | Class | Where it lives | Retention |
|---|---|---|---|
| User name + email | PII | `User` table | until org deletes the user |
| Password hash | secret | `User.passwordHash` (bcrypt) | until rotation |
| Ticket description | potentially-PHI | `Ticket.description` | configurable; default indefinite |
| OAuth tokens | secret | env vars / secrets manager | until rotation |
| Vendor API tokens | secret | env vars / secrets manager | until rotation |
| ML model weights | non-sensitive | `MlModel.weights` JSON | last 5 versions kept |
| Detection evidence | metadata + PHI references | `DetectionHit.evidence` JSON | 90 days recommended |
| Audit logs (comments) | metadata | `Comment` | indefinite (this is the audit trail) |
| Telemetry metrics | non-sensitive | Prometheus → external | per environment |
| External-system logs | as-emitted | Splunk / CW / Azure | per environment retention |

## Cross-border flow considerations

- If your customer's data class is "EU PII", the Anthropic API call from
  the brain crosses the Atlantic. Document this in your DPA. Mitigation:
  set `USE_AI_BRAIN=false` (the rule brain runs entirely on-cluster) or
  use Anthropic's EU endpoint if available.
- Slack webhooks: data is sent to whatever Slack region the org's
  workspace lives in.
- CloudWatch / Azure Monitor / Splunk: data crosses to whichever region
  the customer's vendor account is in. Document.
