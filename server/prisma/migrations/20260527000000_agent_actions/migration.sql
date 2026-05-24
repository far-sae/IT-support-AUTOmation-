-- Phase 10C — agent-dispatched local actions.
--
-- Adds AgentActionKind + AgentActionStatus enums and the AgentAction
-- model: a queued action that the local agent picks up via the
-- pending-actions endpoint and reports back on completion. Linked
-- back to RunbookExecution so settling the action settles the run.

CREATE TYPE "AgentActionKind" AS ENUM (
  'RUN_DIAGNOSTIC', 'RESTART_SERVICE', 'CLEAR_CACHE',
  'DISK_CLEANUP',   'APPLY_PENDING_UPDATES'
);

CREATE TYPE "AgentActionStatus" AS ENUM (
  'QUEUED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'
);

CREATE TABLE "AgentAction" (
    "id"                 TEXT NOT NULL,
    "organizationId"     TEXT NOT NULL,
    "deviceId"           TEXT NOT NULL,
    "runbookExecutionId" TEXT,
    "kind"               "AgentActionKind" NOT NULL,
    "input"              JSONB NOT NULL DEFAULT '{}',
    "status"             "AgentActionStatus" NOT NULL DEFAULT 'QUEUED',
    "result"             JSONB NOT NULL DEFAULT '{}',
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt"       TIMESTAMP(3),
    "completedAt"        TIMESTAMP(3),
    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentAction_organizationId_deviceId_status_idx"
  ON "AgentAction"("organizationId", "deviceId", "status");
CREATE INDEX "AgentAction_runbookExecutionId_idx"
  ON "AgentAction"("runbookExecutionId");

ALTER TABLE "AgentAction"
  ADD CONSTRAINT "AgentAction_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentAction"
  ADD CONSTRAINT "AgentAction_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentAction"
  ADD CONSTRAINT "AgentAction_runbookExecutionId_fkey"
  FOREIGN KEY ("runbookExecutionId") REFERENCES "RunbookExecution"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
