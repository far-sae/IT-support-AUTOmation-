-- Phase 20 — Per-attempt feature snapshots for ML training.

CREATE TABLE "RemediationAttempt" (
    "id"                  TEXT NOT NULL,
    "organizationId"      TEXT NOT NULL,
    "ticketId"            TEXT,
    "runbookExecutionId"  TEXT,
    "runbookKey"          TEXT NOT NULL,
    "featureNames"        JSONB NOT NULL,
    "features"            JSONB NOT NULL,
    "label"               INTEGER NOT NULL,
    "recordedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RemediationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RemediationAttempt_organizationId_runbookKey_recordedAt_idx"
  ON "RemediationAttempt"("organizationId", "runbookKey", "recordedAt");

ALTER TABLE "RemediationAttempt"
  ADD CONSTRAINT "RemediationAttempt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
