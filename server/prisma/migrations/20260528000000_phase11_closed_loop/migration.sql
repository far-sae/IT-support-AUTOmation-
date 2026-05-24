-- Phase 11 — closed-loop autopilot.
--
-- Adds:
--   • Two new AgentActionKind values (ROLL_BACK_LAST_PATCH, TRIGGER_GITHUB_WORKFLOW)
--   • TicketEmbedding model (256-dim float vector stored as JSON)
--   • DailyBrief model (one row per org per day)

ALTER TYPE "AgentActionKind" ADD VALUE 'ROLL_BACK_LAST_PATCH';
ALTER TYPE "AgentActionKind" ADD VALUE 'TRIGGER_GITHUB_WORKFLOW';

CREATE TABLE "TicketEmbedding" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId"       TEXT NOT NULL,
    "text"           TEXT NOT NULL,
    "vector"         JSONB NOT NULL,
    "model"          TEXT NOT NULL DEFAULT 'local-hash-256',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketEmbedding_ticketId_key" ON "TicketEmbedding"("ticketId");
CREATE INDEX "TicketEmbedding_organizationId_idx" ON "TicketEmbedding"("organizationId");

ALTER TABLE "TicketEmbedding"
  ADD CONSTRAINT "TicketEmbedding_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketEmbedding"
  ADD CONSTRAINT "TicketEmbedding_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyBrief" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "forDate"        TIMESTAMP(3) NOT NULL,
    "markdown"       TEXT NOT NULL,
    "stats"          JSONB NOT NULL DEFAULT '{}',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyBrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyBrief_organizationId_forDate_key"
  ON "DailyBrief"("organizationId", "forDate");
CREATE INDEX "DailyBrief_organizationId_createdAt_idx"
  ON "DailyBrief"("organizationId", "createdAt");

ALTER TABLE "DailyBrief"
  ADD CONSTRAINT "DailyBrief_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
