-- Phase 10A — autonomous remediation (Tier 1).
--
-- Adds RunbookStatus + RunbookRisk enums and the RunbookExecution table
-- that records every attempt the runbook engine makes to auto-resolve a
-- ticket. Per-org enable/disable is encoded in Organization.settings JSON
-- and doesn't require its own column.

CREATE TYPE "RunbookStatus" AS ENUM (
  'RUNNING', 'SUCCEEDED', 'FAILED', 'AWAITING_USER', 'AWAITING_AGENT', 'CANCELLED'
);

CREATE TYPE "RunbookRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "RunbookExecution" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId"       TEXT NOT NULL,
    "runbookKey"     TEXT NOT NULL,
    "status"         "RunbookStatus" NOT NULL DEFAULT 'RUNNING',
    "risk"           "RunbookRisk"   NOT NULL,
    "confidence"     DOUBLE PRECISION NOT NULL,
    "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"    TIMESTAMP(3),
    "decision"       JSONB NOT NULL DEFAULT '{}',
    "approvedById"   TEXT,
    CONSTRAINT "RunbookExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RunbookExecution_organizationId_ticketId_idx" ON "RunbookExecution"("organizationId", "ticketId");
CREATE INDEX "RunbookExecution_organizationId_status_idx"   ON "RunbookExecution"("organizationId", "status");

ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_ticketId_fkey"       FOREIGN KEY ("ticketId")       REFERENCES "Ticket"("id")       ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "RunbookExecution" ADD CONSTRAINT "RunbookExecution_approvedById_fkey"   FOREIGN KEY ("approvedById")   REFERENCES "User"("id")         ON DELETE SET NULL ON UPDATE CASCADE;
