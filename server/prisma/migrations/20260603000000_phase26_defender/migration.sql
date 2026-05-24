-- Phase 26 — Daily agentic defender runs + their decisions/outcomes.

CREATE TYPE "DefenderStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'HALTED');

CREATE TABLE "DefenderRun" (
    "id"                 TEXT NOT NULL,
    "organizationId"     TEXT NOT NULL,
    "runDate"            TIMESTAMP(3) NOT NULL,
    "status"             "DefenderStatus" NOT NULL DEFAULT 'RUNNING',
    "situation"          JSONB NOT NULL DEFAULT '{}',
    "toolCalls"          JSONB NOT NULL DEFAULT '[]',
    "decisions"          JSONB NOT NULL DEFAULT '[]',
    "briefing"           TEXT,
    "iterations"         INTEGER NOT NULL DEFAULT 0,
    "errorReason"        TEXT,
    "startedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"        TIMESTAMP(3),
    "outcomesMeasuredAt" TIMESTAMP(3),
    "outcomes"           JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "DefenderRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DefenderRun_organizationId_runDate_key"
  ON "DefenderRun"("organizationId", "runDate");
CREATE INDEX "DefenderRun_organizationId_status_startedAt_idx"
  ON "DefenderRun"("organizationId", "status", "startedAt");

ALTER TABLE "DefenderRun"
  ADD CONSTRAINT "DefenderRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
