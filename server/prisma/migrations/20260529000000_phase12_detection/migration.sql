-- Phase 12 — Sigma-style detection engine.
--
-- Adds:
--   • DetectionSeverity enum
--   • DetectionHit model (one row per (org, rule, window))

CREATE TYPE "DetectionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "DetectionHit" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleKey"        TEXT NOT NULL,
    "severity"       "DetectionSeverity" NOT NULL,
    "count"          INTEGER NOT NULL DEFAULT 0,
    "windowStart"    TIMESTAMP(3) NOT NULL,
    "windowEnd"      TIMESTAMP(3) NOT NULL,
    "evidence"       JSONB NOT NULL DEFAULT '{}',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DetectionHit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DetectionHit_organizationId_ruleKey_windowStart_key"
  ON "DetectionHit"("organizationId", "ruleKey", "windowStart");
CREATE INDEX "DetectionHit_organizationId_createdAt_idx"
  ON "DetectionHit"("organizationId", "createdAt");
CREATE INDEX "DetectionHit_organizationId_acknowledgedAt_idx"
  ON "DetectionHit"("organizationId", "acknowledgedAt");

ALTER TABLE "DetectionHit"
  ADD CONSTRAINT "DetectionHit_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
