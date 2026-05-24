-- Phase 10B — autonomous remediation loop with learning.
--
-- 1. Extends RunbookStatus with AWAITING_VERIFICATION (system-driven, no human).
-- 2. Adds RunbookExecution.verifyAt (cron uses it to auto-finalize) and
--    .brainLog (Claude's tool-use reasoning log).
-- 3. Adds RemediationOutcome — per-org success/failure counters that the
--    brain reads to bias future runbook choices.

-- ── 1. Extend the enum ──────────────────────────────────────────────

ALTER TYPE "RunbookStatus" ADD VALUE 'AWAITING_VERIFICATION';

-- ── 2. RunbookExecution additions ──────────────────────────────────

ALTER TABLE "RunbookExecution" ADD COLUMN "verifyAt" TIMESTAMP(3);
ALTER TABLE "RunbookExecution" ADD COLUMN "brainLog" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "RunbookExecution_verifyAt_idx" ON "RunbookExecution"("verifyAt");

-- ── 3. RemediationOutcome ───────────────────────────────────────────

CREATE TABLE "RemediationOutcome" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "signature"      TEXT NOT NULL,
    "runbookKey"     TEXT NOT NULL,
    "successes"      INTEGER NOT NULL DEFAULT 0,
    "failures"       INTEGER NOT NULL DEFAULT 0,
    "escalations"    INTEGER NOT NULL DEFAULT 0,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RemediationOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemediationOutcome_organizationId_signature_runbookKey_key"
  ON "RemediationOutcome"("organizationId", "signature", "runbookKey");
CREATE INDEX "RemediationOutcome_organizationId_signature_idx"
  ON "RemediationOutcome"("organizationId", "signature");

ALTER TABLE "RemediationOutcome"
  ADD CONSTRAINT "RemediationOutcome_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
