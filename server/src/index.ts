/**
 * Relay API entry point.
 *
 * Boots Express, mounts every route, attaches socket.io to the same HTTP
 * server (so the JWT handshake middleware can authenticate web-socket
 * clients) and starts listening.
 */

import http from "node:http";
import express from "express";
import cors from "cors";

import { env } from "./env.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { initSocket } from "./realtime/socket.js";

import { passport } from "./auth/passport.js";

import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { ticketsRouter } from "./routes/tickets.js";
import { triageRouter } from "./routes/triage.js";
import { devicesRouter } from "./routes/devices.js";
import { remoteSessionsRouter } from "./routes/remoteSessions.js";
import { kbRouter } from "./routes/kb.js";
import { statusRouter } from "./routes/status.js";
import { incidentsRouter } from "./routes/incidents.js";
import { analyticsRouter } from "./routes/analytics.js";
import { surveyRouter } from "./routes/survey.js";
import { emailRouter } from "./routes/email.js";
import { attachmentsRouter } from "./routes/attachments.js";
import { reportsRouter } from "./routes/reports.js";
import { organizationRouter } from "./routes/organization.js";
import { invitesRouter, invitePublicRouter } from "./routes/invites.js";
import { platformRouter } from "./routes/platform.js";
import { agentRouter } from "./routes/agent.js";
import { agentTokensRouter, deviceMetricsRouter } from "./routes/agentTokens.js";
import { runbookCatalogRouter, runbookExecutionsRouter, ticketRunbookExecutionsRouter } from "./routes/runbooks.js";
import { briefRouter } from "./routes/brief.js";
import { policiesRouter } from "./routes/policies.js";
import { detectionsRouter } from "./routes/detections.js";
import { workflowsRouter } from "./routes/workflows.js";
import { mlRouter } from "./routes/ml.js";
import { threatRouter } from "./routes/threat.js";
import { defenderRouter } from "./routes/defender.js";
import { attackRouter } from "./routes/attack.js";

import { ensureBucket } from "./storage/s3.js";
import { startImapPoller } from "./email/ingest.js";
import { startSlaCron } from "./jobs/sla.js";
import { startAutopilotCron } from "./jobs/autopilot.js";
import { startDailyBriefCron } from "./jobs/dailyBrief.js";
import { startDetectionCron } from "./detect/cron.js";
import { startWorkflowCron } from "./workflows/cron.js";
import { startMlTrainerCron } from "./ml/cron.js";
import { startThreatIntelCron } from "./threat/cron.js";
import { startDefenderCron } from "./defender/cron.js";
import { startAttackRefreshCron } from "./attack/cron.js";
import { startSensorCron } from "./sensors/cron.js";
import { registerKafkaSink } from "./integrations/kafka.js";
import { registerEsSink } from "./integrations/elasticsearch.js";
import { registerDetectionNotifier } from "./events/notifier.js";
import { metricsExposition, metricsContentType } from "./observability/metrics.js";
// Phase 15 — observability extras.
import { log } from "./observability/logger.js";
import { registerEsLogSink } from "./observability/sinks/elasticsearch_logs.js";
import { registerSplunkSink } from "./observability/sinks/splunk.js";
import { registerAzureMonitorSink } from "./observability/sinks/azure_monitor.js";
import {
  registerCloudwatchLogSink, startCloudwatchMetricsExporter,
} from "./observability/sinks/cloudwatch.js";

const app = express();

app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(passport.initialize());

app.get("/healthz", (_req, res) => res.json({ ok: true, env: env.NODE_ENV }));

// Phase 11 — Prometheus exposition. Public-ish; scraped from the Prom container.
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", metricsContentType());
  res.send(await metricsExposition());
});

// Public routes
app.use("/api/auth", authRouter);
app.use("/api/status", statusRouter);
app.use("/api/survey", surveyRouter);
app.use("/api/email", emailRouter);
app.use("/api/invites/lookup", invitePublicRouter);

// Agent check-in is authenticated by an enrollment token, not a JWT —
// mounted outside requireAuth.
app.use("/api/agent", agentRouter);

// Protected routes (tenant-scoped)
app.use("/api/organization", organizationRouter);
app.use("/api/invites", invitesRouter);
app.use("/api/users", usersRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/attachments", attachmentsRouter);
app.use("/api/triage", triageRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/devices/:deviceId/metrics", deviceMetricsRouter);
app.use("/api/agent-tokens", agentTokensRouter);
app.use("/api/remote-sessions", remoteSessionsRouter);
app.use("/api/runbook-catalog", runbookCatalogRouter);
app.use("/api/runbook-executions", runbookExecutionsRouter);
app.use("/api/tickets/:ticketId/runbook-executions", ticketRunbookExecutionsRouter);
// Phase 11 — closed-loop endpoints.
app.use("/api/brief", briefRouter);
app.use("/api/policies", policiesRouter);
// Phase 12 — detection.
app.use("/api/detections", detectionsRouter);
// Phase 13 — multi-step workflows.
app.use("/api/workflows", workflowsRouter);
// Phase 16 — ML training + model management.
app.use("/api/ml", mlRouter);
// Phase 25 — threat intelligence.
app.use("/api/threat", threatRouter);
// Phase 26 — daily agentic defender.
app.use("/api/defender", defenderRouter);
// Phase 27 — behavioural defence: MITRE ATT&CK + generated rules + sensors.
app.use("/api/attack", attackRouter);
app.use("/api/kb", kbRouter);
app.use("/api/incidents", incidentsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/reports", reportsRouter);

// Platform-admin routes (cross-org, platformMode)
app.use("/api/platform", platformRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = http.createServer(app);
initSocket(server);

server.listen(env.PORT, () => {
  console.log(`📡 Relay API listening on http://localhost:${env.PORT}  (${env.NODE_ENV})`);

  // Background services — each one self-skips if its config is absent.
  void ensureBucket();
  startImapPoller();
  startSlaCron();
  startAutopilotCron();
  startDailyBriefCron();
  // Phase 12 — detection cron + bus sinks. Kafka / ES are no-ops without env.
  startDetectionCron();
  registerDetectionNotifier();
  void registerKafkaSink().catch((err) => console.error("[kafka] register failed:", err));
  void registerEsSink().catch((err) => console.error("[elasticsearch] register failed:", err));
  // Phase 13 — workflow executor.
  startWorkflowCron();
  // Phase 16 — daily ML training.
  startMlTrainerCron();
  // Phase 25 — threat-intel polling.
  startThreatIntelCron();
  // Phase 26 — daily defender agent.
  startDefenderCron();
  // Phase 27 — behavioural-defence crons.
  startAttackRefreshCron();
  startSensorCron();
  // Phase 15 — log sinks + metric exporter. Each one self-skips if its
  // env isn't configured.
  void registerEsLogSink().catch((err) => console.error("[logger] ES sink register failed:", err));
  registerSplunkSink();
  registerAzureMonitorSink();
  registerCloudwatchLogSink();
  startCloudwatchMetricsExporter();
  log.info("relay-server booted", {
    port: env.PORT,
    env: env.NODE_ENV,
    nodeVersion: process.version,
  });
});
