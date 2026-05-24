-- Phase 13 — multi-step workflow orchestration.

CREATE TYPE "WorkflowExecutionStatus" AS ENUM (
  'RUNNING', 'WAITING', 'AWAITING_APPROVAL',
  'SUCCEEDED', 'FAILED', 'CANCELLED', 'COMPENSATING'
);
CREATE TYPE "WorkflowStepStatus" AS ENUM (
  'PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED',
  'FAILED', 'SKIPPED', 'COMPENSATED'
);

CREATE TABLE "WorkflowExecution" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId"       TEXT NOT NULL,
    "workflowKey"    TEXT NOT NULL,
    "status"         "WorkflowExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "currentStepKey" TEXT,
    "context"        JSONB NOT NULL DEFAULT '{}',
    "errorReason"    TEXT,
    "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"    TIMESTAMP(3),
    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowExecution_organizationId_status_idx"
  ON "WorkflowExecution"("organizationId", "status");
CREATE INDEX "WorkflowExecution_organizationId_ticketId_idx"
  ON "WorkflowExecution"("organizationId", "ticketId");

ALTER TABLE "WorkflowExecution"
  ADD CONSTRAINT "WorkflowExecution_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowExecution"
  ADD CONSTRAINT "WorkflowExecution_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkflowStepExecution" (
    "id"                  TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "stepKey"             TEXT NOT NULL,
    "sequence"            INTEGER NOT NULL,
    "status"              "WorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "output"              JSONB NOT NULL DEFAULT '{}',
    "errorReason"         TEXT,
    "resumeAt"            TIMESTAMP(3),
    "startedAt"           TIMESTAMP(3),
    "completedAt"         TIMESTAMP(3),
    CONSTRAINT "WorkflowStepExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowStepExecution_workflowExecutionId_stepKey_key"
  ON "WorkflowStepExecution"("workflowExecutionId", "stepKey");
CREATE INDEX "WorkflowStepExecution_workflowExecutionId_sequence_idx"
  ON "WorkflowStepExecution"("workflowExecutionId", "sequence");

ALTER TABLE "WorkflowStepExecution"
  ADD CONSTRAINT "WorkflowStepExecution_workflowExecutionId_fkey"
  FOREIGN KEY ("workflowExecutionId") REFERENCES "WorkflowExecution"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
