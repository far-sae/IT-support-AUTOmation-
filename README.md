# Relay

Internal IT support automation platform. Ticket triage, comment threads, remote support, asset monitoring, knowledge base, public status page, and reporting — all in one monorepo.

```
┌─ client/  ─ React 18 + Vite + TypeScript, Tailwind, TanStack Query, Recharts, socket.io-client
└─ server/  ─ Express + Prisma (Postgres), JWT + passport (Google + Microsoft SSO),
              nodemailer + imapflow, AWS SDK (S3-compatible), node-cron, pdfkit, socket.io
```

## What's in the box

| Feature | Where it lives |
|---|---|
| Ticket triage — transparent rule engine + optional Anthropic AI path | [server/src/triage.ts](server/src/triage.ts) · [server/src/routes/triage.ts](server/src/routes/triage.ts) |
| Ticket queue, role-scoped, with live triage preview + attachments | [client/src/pages/tickets/](client/src/pages/tickets/) |
| Comment threads (public + agent internal notes) | [server/src/routes/comments.ts](server/src/routes/comments.ts) · [client/src/pages/tickets/CommentThread.tsx](client/src/pages/tickets/CommentThread.tsx) |
| Remote support — simulated session, live event log, timer + latency | [server/src/routes/remoteSessions.ts](server/src/routes/remoteSessions.ts) · [client/src/pages/RemotePage.tsx](client/src/pages/RemotePage.tsx) |
| Asset monitoring — fleet table, health filter, disk/RAM gauges | [client/src/pages/AssetsPage.tsx](client/src/pages/AssetsPage.tsx) |
| Knowledge base | [client/src/pages/KnowledgePage.tsx](client/src/pages/KnowledgePage.tsx) |
| Inbound email → triaged ticket (IMAP poll + simulator endpoint) | [server/src/email/ingest.ts](server/src/email/ingest.ts) |
| Outbound auto-reply + survey + comment-notify + SLA-breach mail | [server/src/email/templates.ts](server/src/email/templates.ts) |
| File attachments on S3-compatible storage (MinIO in dev) | [server/src/routes/attachments.ts](server/src/routes/attachments.ts) · [server/src/storage/s3.ts](server/src/storage/s3.ts) |
| Satisfaction surveys (one-time tokens, public submit) | [server/src/survey/survey.ts](server/src/survey/survey.ts) · [client/src/pages/SurveyPage.tsx](client/src/pages/SurveyPage.tsx) |
| Public status page (uptime + active incidents + history) | [server/src/routes/status.ts](server/src/routes/status.ts) · [client/src/pages/StatusPage.tsx](client/src/pages/StatusPage.tsx) |
| Incident management (admin) | [server/src/routes/incidents.ts](server/src/routes/incidents.ts) · [client/src/pages/IncidentsPage.tsx](client/src/pages/IncidentsPage.tsx) |
| node-cron SLA-breach alerter | [server/src/jobs/sla.ts](server/src/jobs/sla.ts) |
| Admin CSV + PDF reports (tickets & CSAT, with date range) | [server/src/routes/reports.ts](server/src/routes/reports.ts) · [client/src/pages/ReportsPage.tsx](client/src/pages/ReportsPage.tsx) |
| Real-time updates over socket.io (typed events, JWT handshake) | [server/src/realtime/socket.ts](server/src/realtime/socket.ts) · [client/src/realtime/SocketProvider.tsx](client/src/realtime/SocketProvider.tsx) |
| Tests — triage engine, auth middleware, survey token flow, SLA-breach scanner | `npm test` (41 tests) |

## Quick start with Docker

```bash
cp .env.example .env          # optional — defaults work as-is
docker compose up --build
```

Then open:

| URL | What |
|---|---|
| <http://localhost:5173>           | The Relay app |
| <http://localhost:5173/status>    | Public status page (no login) |
| <http://localhost:4000>           | API directly |
| <http://localhost:8025>           | Mailpit — every outbound email lands here |
| <http://localhost:9001>           | MinIO console (login `relayminio` / `relayminio`) |

Seed the demo data once Postgres is healthy (the production image ships the
compiled seed, so use the `:compiled` variant inside the container):

```bash
docker compose exec server npm run seed:compiled
```

For local dev outside Docker the un-compiled `npm run seed` works (it shells
out to `tsx`).

That gives you three logins (all password `relay1234`):

| Role     | Email              | What they see |
|----------|--------------------|---------------|
| ADMIN    | admin@relay.io     | Everything — Users, Incidents, Reports |
| AGENT    | agent@relay.io     | Tickets queue, Remote, Assets |
| EMPLOYEE | employee@relay.io  | Their own tickets, knowledge base |

## Local development (without Docker)

You'll need Postgres running locally. Then:

```bash
npm install                                     # installs both workspaces

# Apply schema + seed data
npm run prisma:deploy --workspace server
npm run seed

# Run server (port 4000) + client (port 5173) together
npm run dev
```

Run the tests:

```bash
npm test
# →  41 / 41 passing
#    triage engine · auth middleware · survey-token flow · SLA-breach scanner
```

Build everything for production:

```bash
npm run build
```

## Configuration

Every config lives in `.env`. The committed `.env.example` documents each key with sensible Docker defaults. Highlights:

| Env | Default in compose | Notes |
|---|---|---|
| `DATABASE_URL`              | Postgres in compose         | Required everywhere |
| `JWT_SECRET`                | placeholder in compose      | **Change for production**, ≥ 16 chars |
| `SMTP_HOST` / `SMTP_PORT`   | `mailpit:1025`              | Unset → mail sends are no-ops (logged) |
| `IMAP_HOST` etc.            | unset                       | Polling disabled if missing |
| `GOOGLE_CLIENT_ID` etc.     | unset                       | Google SSO route only mounted if set |
| `MICROSOFT_CLIENT_ID` etc.  | unset                       | Microsoft SSO route only mounted if set |
| `S3_ENDPOINT` + creds       | `http://minio:9000`         | Attachments return 503 if missing |
| `USE_AI_TRIAGE`             | `false`                     | When `true` + `ANTHROPIC_API_KEY` set, triage routes through Claude with a JSON-only contract and falls back to the rule engine on any error |
| `SLA_CHECK_INTERVAL_MINUTES`| `5`                         | node-cron interval |

### Setting up Google + Microsoft SSO

The OAuth strategies only mount when their client ID + secret are both present. To wire them up:

1. **Google** — [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Create an OAuth 2.0 Client ID (type "Web application"). Add an authorized redirect URI of `http://localhost:4000/api/auth/google/callback` (the prefix is `${OAUTH_CALLBACK_BASE_URL}`). Drop the client ID and secret into `.env`.

2. **Microsoft** — [Entra ID → App registrations → New registration](https://entra.microsoft.com). Under **Authentication → Web → Redirect URIs**, add `http://localhost:4000/api/auth/microsoft/callback`. Generate a client secret under **Certificates & secrets**. Set `MICROSOFT_TENANT=common` (multi-tenant) or your tenant ID. Drop the values into `.env`.

3. Restart the server. `GET /api/auth/providers` will report which strategies are live, and the login page will show the matching SSO buttons.

Local + SSO accounts share the User table by email — sign in once via SSO and a row is created in EMPLOYEE role; existing local users get linked automatically on first SSO sign-in.

## How the triage engine works

`triage(text)` is a transparent rule engine: per-category keyword sets (Network, Hardware, Account & Access, Email, Security, Software) and per-priority keyword sets (Critical, High, Medium, Low). Confidence rises with keyword-match count, capped at 1. Category drives the assigned team, priority drives the SLA target (1h / 4h / 1 BD / 3 BD). Source code with the full keyword tables: [server/src/triage.ts](server/src/triage.ts).

Setting `USE_AI_TRIAGE=true` with an `ANTHROPIC_API_KEY` routes calls through `claude-sonnet-4-5` with a strict JSON contract; validation failures, schema mismatches, network errors and timeouts all fall back to the rule engine. The seed script and the ticket-create endpoint always run the actual engine — there's no separate "demo" triage data.

## API surface

| Route | Auth | Notes |
|---|---|---|
| `POST /api/auth/{register,login}`           | public                | JWT issued in body |
| `GET  /api/auth/me`                         | any role              | `{ user }` |
| `GET  /api/auth/{google,microsoft}`         | public                | starts SSO; only mounted when credentials set |
| `GET  /api/auth/providers`                  | public                | which SSO strategies are live |
| `GET  /api/status`                          | public                | components + uptime + incidents |
| `GET/POST /api/survey/:token`               | public                | one-time tokens; 410 on re-submit |
| `POST /api/email/inbound`                   | public                | simulates IMAP delivery |
| `GET  /api/tickets`                         | any role              | EMPLOYEE → their own only |
| `POST /api/tickets`                         | any role              | triages + sends auto-reply + `ticket:created` |
| `GET/PATCH /api/tickets/:id`                | any role / AGENT+     | resolving sends survey email |
| `/api/tickets/:id/comments`                 | role-filtered         | EMPLOYEE never sees internal notes |
| `/api/tickets/:id/attachments` + `/api/attachments/:id/download` | any role | role-scoped, presigned URL |
| `POST /api/triage/preview`                  | any role              | live preview as the form is typed |
| `GET/POST /api/devices`                     | AGENT+ / ADMIN        | full CRUD |
| `/api/remote-sessions`                      | AGENT+                | start, append-event, end |
| `GET  /api/kb?q=…`                          | any role              | keyword search |
| `GET  /api/incidents` + admin CRUD          | ADMIN                 | flips component status when set |
| `GET  /api/analytics`                       | AGENT+                | KPIs + CSAT + fleet + KB deflection |
| `GET  /api/reports/{tickets,csat}.{csv,pdf}`| ADMIN                 | optional `?from=`, `?to=` |

Every protected route returns **401** on a missing/invalid token and **403** on an insufficient role. All write endpoints emit a typed socket event (`ticket:created`, `ticket:updated`, `device:updated`, `session:event`, `sla:breach`, `incident:updated`, `analytics:updated`) that the client uses to invalidate matching TanStack Query caches.

## CI

`/.github/workflows/ci.yml` runs on every push + pull request:

1. **test** — installs deps, generates the Prisma client, applies migrations against a Postgres service container, runs `vitest` for the server, lints, and builds the Vite client.
2. **build-images** — needs `test`; uses `docker/setup-buildx-action` + `docker/build-push-action` to build both Dockerfiles (cached via GHA cache backend). Push is disabled by default; flip on a `docker/login-action` step + a registry secret to enable.

## Design

Warm off-white `#F4F1E8` paper, near-black `#17160E` ink, one bold lime `#C8F23A` used sparingly on dark surfaces and primary buttons. Display headings in Bricolage Grotesque, body in Inter, monospace (JetBrains Mono) for IDs and timestamps. No gradients. 1px borders, generous whitespace, rounded corners, sentence case everywhere. Visible focus states; labelled inputs.

## Repo layout

```
.
├── README.md
├── .env.example
├── docker-compose.yml
├── .dockerignore
├── .github/workflows/ci.yml
├── client/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/                      # routes, pages, auth, realtime, UI primitives
├── server/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts
│   │   └── migrations/           # initial migration committed
│   └── src/
│       ├── index.ts              # Express + http + socket.io entry
│       ├── env.ts                # zod-validated config
│       ├── db.ts                 # Prisma singleton
│       ├── errors.ts             # AppError + handlers
│       ├── ref.ts                # nextRefCode (INC-1xxx)
│       ├── triage.ts             # rule engine + optional AI
│       ├── triage.test.ts
│       ├── auth/                 # jwt + middleware + passport
│       ├── realtime/             # socket.io + typed events
│       ├── email/                # mailer + templates + IMAP ingest
│       ├── survey/               # token service + tests
│       ├── storage/              # S3 client + presigner
│       ├── jobs/                 # SLA cron + tests
│       ├── reports/              # CSV + PDF builders
│       └── routes/               # every endpoint
└── package.json                  # npm workspaces root
```
