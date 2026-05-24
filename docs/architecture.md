# Relay — system architecture

The complete architectural picture, including how Phases 1-24 fit
together. Use this as the new-engineer onboarding doc.

## High-level system diagram

```mermaid
flowchart LR
  subgraph "Inbound"
    Browser[Browser SPA]
    Email[IMAP inbox]
    Agent[Desktop agent]
  end

  subgraph "API layer"
    Server[Express server<br/>Multi-tenant via ALS]
  end

  subgraph "Brain"
    Triage[Triage classifier]
    RuleBrain[Rule brain]
    AiBrain[AI brain<br/>Claude tool-use]
    Memory[Vector memory<br/>hashed embeddings]
    Policy[Policy engine<br/>+ OPA]
    Risk[Risk scorer 0-100]
    ML[ML predict<br/>logistic / GBT]
  end

  subgraph "Action layer"
    Runbooks[Runbooks Tier 1-4]
    Workflows[Workflow executor<br/>Postgres-durable]
    AgentActions[AgentAction queue]
  end

  subgraph "Storage (Postgres)"
    DB[(Tickets<br/>Comments<br/>RunbookExec<br/>WorkflowExec<br/>AgentAction<br/>RemediationOutcome<br/>RemediationAttempt<br/>TicketEmbedding<br/>DetectionHit<br/>MlModel<br/>DailyBrief)]
  end

  subgraph "Observability"
    Metrics[Prometheus]
    Logger[Structured logger]
    Sinks[ES / Splunk / CloudWatch / Azure]
    Grafana[Grafana dashboards]
  end

  subgraph "Event-driven"
    Bus[In-process bus]
    Kafka[Kafka mirror]
    Detection[Detection cron 5m]
    Notifier[Slack notifier]
  end

  subgraph "Outbound integrations"
    Slack[Slack]
    GitHub[GitHub Actions]
    Firewall[PaloAlto/pfSense]
    ITSM[ServiceNow/Jira]
  end

  Browser --> Server
  Email --> Server
  Agent --> Server

  Server --> Triage --> RuleBrain
  RuleBrain -.opt-in.-> AiBrain
  RuleBrain --> Memory & Policy & Risk & ML
  Policy --> Runbooks
  Runbooks --> Workflows
  Runbooks --> AgentActions
  AgentActions --> Agent

  Server --> DB
  Runbooks --> DB
  Workflows --> DB

  Server --> Bus
  Runbooks --> Bus
  Bus --> Notifier --> Slack
  Bus --> Kafka
  Bus --> Sinks
  Detection --> DB
  Detection --> Bus

  Runbooks --> GitHub
  Runbooks --> Firewall
  Runbooks --> ITSM

  Server --> Logger --> Sinks
  Server --> Metrics --> Grafana
```

## Request lifecycle — ticket creation

```mermaid
sequenceDiagram
  participant U as User
  participant API as API server
  participant ALS as Tenant ALS
  participant DB as Postgres
  participant Brain as Brain (rule)
  participant Pol as Policy engine
  participant RB as Runbook
  participant Bus as Event bus

  U->>API: POST /api/tickets
  API->>ALS: setTenantContext(orgId)
  API->>DB: prisma.ticket.create (auto-scoped by org)
  API->>Brain: decideAndExecute(ticket, triage)

  Brain->>DB: stats + memory + ml-predict
  Brain->>RB: pickRunbook
  RB-->>Brain: { runbook, confidence }

  Brain->>Pol: evaluatePolicies(ticket, runbook)
  Pol-->>Brain: ALLOW or DENY

  alt ALLOW
    Brain->>RB: execute()
    RB->>DB: write execution + comments + close ticket
    RB->>Bus: emit("runbook.completed")
  else DENY
    Brain->>DB: write execution with status=AWAITING_AGENT
    Brain->>Bus: emit("policy.denied")
  end

  Bus->>Bus: fan to Slack / Kafka / ES / metrics
  API-->>U: 201 + ticket
```

## Workflow lifecycle — multi-step plan

```mermaid
sequenceDiagram
  participant API as API
  participant Eng as Workflow engine
  participant DB as Postgres
  participant Cron as Workflow cron (1m)

  API->>Eng: startWorkflow(ticketId, key)
  Eng->>DB: create WorkflowExecution + pre-create steps PENDING
  Eng->>DB: advance first step (RUNNING → COMPLETED / WAITING)

  loop every minute
    Cron->>DB: list RUNNING + WAITING executions
    Cron->>Eng: advanceOne()
    alt step returns COMPLETED
      Eng->>DB: mark step SUCCEEDED, point to next
    else step returns WAITING(resumeAt)
      Eng->>DB: mark step WAITING + persist resumeAt
    else step returns FAILED
      Eng->>DB: set execution status=COMPENSATING
      Eng->>DB: walk completed steps, call compensate()
    end
  end
```

## Detection cycle

```mermaid
sequenceDiagram
  participant Cron as Detection cron (5m)
  participant Reg as Rule registry
  participant DB as Postgres
  participant Bus as Event bus
  participant Slack as Slack
  participant Met as Prometheus

  loop every 5 minutes
    Cron->>DB: list non-platform orgs
    loop for each org
      Cron->>Reg: 20 rules
      loop for each rule
        Reg->>DB: rule.detect() — queries tickets/runs/devices
        DB-->>Reg: matches
        alt match exists
          Reg->>DB: upsert DetectionHit (dedupe by windowStart)
          alt NEW row
            Reg->>Bus: emit("detection.hit")
            Bus->>Slack: notifySlackDetection
            Bus->>Met: detection_hits_total counter
          end
        end
      end
    end
  end
```

## ML loop

```mermaid
sequenceDiagram
  participant RB as Runbook engine
  participant DB as Postgres
  participant Cron as ML trainer (24h)
  participant Pred as Predict path
  participant Brain as Brain
  participant Cache as 5-min cache

  Note over RB,DB: Per attempt
  RB->>DB: write RunbookExecution result (succeeded/failed)
  RB->>DB: write RemediationAttempt (features + label)

  Note over Cron,DB: Once per day
  Cron->>DB: load RemediationAttempt (per org)
  Cron->>Cron: train GBT (or logistic if too few)
  Cron->>DB: write MlModel v(n+1), flip active

  Note over Brain,Pred: Per ticket
  Brain->>Pred: predictSuccess(features)
  Pred->>Cache: lookup
  alt cache miss
    Pred->>DB: load active MlModel
    Pred->>Cache: store 5min
  end
  Pred-->>Brain: P(success)
  Brain->>Brain: blend 50/50 with heuristic
```

## Data store map

| Table | Purpose | Phase |
|---|---|---|
| Organization | Tenant root | 6 |
| User, OrgInvite | Identity | 1, 6 |
| Ticket, Comment, Attachment | Core ticketing | 1 |
| SurveyResponse | Post-resolution CSAT | 3 |
| Device, DeviceMetric, AgentEnrollmentToken | Endpoint fleet | 7 |
| KbArticle | Self-service KB | 2 |
| ServiceComponent, Incident | Status page | 4 |
| RunbookExecution | Tier 1-4 audit | 10A |
| RemediationOutcome | Aggregate learning counts | 10B |
| AgentAction | Tier 2 agent dispatch | 10C |
| TicketEmbedding | Vector memory | 11 |
| DailyBrief | Morning summaries | 11 |
| DetectionHit | Sigma-style detection log | 12 |
| WorkflowExecution, WorkflowStepExecution | Multi-step plans | 13 |
| MlModel | Versioned learned classifiers | 16 |
| RemediationAttempt | Per-attempt ML training data | 20 |

## Background jobs

| Job | Frequency | Purpose |
|---|---|---|
| Autopilot | 1 min | settleVerifications + retry stuck tickets |
| Workflow advancer | 1 min | drive RUNNING/WAITING workflow steps |
| SLA scanner | 5 min | flag tickets past SLA, notify agents |
| Detection | 5 min | run all 20 rules per org |
| Daily brief | 24h (08:00) | generate per-org Markdown brief |
| ML trainer | 24h (03:00) | train classifier from RemediationAttempt |
| IMAP poller | configurable | pull inbound email into tickets |

## Boundaries — what's NOT in Relay

- **Identity provider** — we accept Google / Microsoft / local; we don't
  *be* an identity provider.
- **Endpoint protection** — the agent reports telemetry + dispatches
  actions; it doesn't replace MDM / EDR.
- **Ticket queue substitution** — we ARE the queue; we don't shim into
  ServiceNow / Jira. The ITSM integrations push out, they don't replace.
- **SIEM** — we have detection but we don't ingest raw logs at scale; for
  that pair us with Splunk / Elastic SIEM via the log sinks.
