-- Phase 27 — Behavioural detection: MITRE ATT&CK library + sensor alerts
-- + AI-generated detection rules with human approval workflow.

CREATE TYPE "GeneratedRuleStatus" AS ENUM ('DRAFT', 'TESTING', 'APPROVED', 'RETIRED', 'REJECTED');

CREATE TABLE "AttackTechnique" (
    "id"           TEXT NOT NULL,
    "mitreId"      TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "tactic"       TEXT NOT NULL,
    "description"  TEXT NOT NULL,
    "dataSources"  JSONB NOT NULL DEFAULT '[]',
    "platforms"    JSONB NOT NULL DEFAULT '[]',
    "mitigations"  JSONB NOT NULL DEFAULT '[]',
    "revoked"      BOOLEAN NOT NULL DEFAULT false,
    "modified"     TIMESTAMP(3) NOT NULL,
    "ingestedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttackTechnique_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttackTechnique_mitreId_key" ON "AttackTechnique"("mitreId");
CREATE INDEX "AttackTechnique_tactic_idx"  ON "AttackTechnique"("tactic");
CREATE INDEX "AttackTechnique_revoked_idx" ON "AttackTechnique"("revoked");

CREATE TABLE "SensorAlert" (
    "id"               TEXT NOT NULL,
    "organizationId"   TEXT NOT NULL,
    "source"           TEXT NOT NULL,
    "externalId"       TEXT NOT NULL,
    "sourceRuleId"     TEXT NOT NULL,
    "level"            INTEGER NOT NULL,
    "description"      TEXT NOT NULL,
    "agentName"        TEXT,
    "srcIp"            TEXT,
    "dstIp"            TEXT,
    "mitreTechniqueId" TEXT,
    "rawAlert"         JSONB NOT NULL DEFAULT '{}',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SensorAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SensorAlert_organizationId_source_externalId_key"
  ON "SensorAlert"("organizationId", "source", "externalId");
CREATE INDEX "SensorAlert_organizationId_createdAt_idx"
  ON "SensorAlert"("organizationId", "createdAt");
CREATE INDEX "SensorAlert_organizationId_mitreTechniqueId_createdAt_idx"
  ON "SensorAlert"("organizationId", "mitreTechniqueId", "createdAt");

ALTER TABLE "SensorAlert"
  ADD CONSTRAINT "SensorAlert_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GeneratedRule" (
    "id"                TEXT NOT NULL,
    "organizationId"    TEXT,
    "attackTechniqueId" TEXT,
    "title"             TEXT NOT NULL,
    "description"       TEXT NOT NULL,
    "severity"          "DetectionSeverity" NOT NULL DEFAULT 'MEDIUM',
    "logic"             JSONB NOT NULL,
    "status"            "GeneratedRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "testResults"       JSONB NOT NULL DEFAULT '{}',
    "createdBy"         TEXT NOT NULL,
    "rationale"         TEXT,
    "approvedBy"        TEXT,
    "approvedAt"        TIMESTAMP(3),
    "rejectionReason"   TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneratedRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeneratedRule_organizationId_status_createdAt_idx"
  ON "GeneratedRule"("organizationId", "status", "createdAt");
CREATE INDEX "GeneratedRule_attackTechniqueId_idx"
  ON "GeneratedRule"("attackTechniqueId");

ALTER TABLE "GeneratedRule"
  ADD CONSTRAINT "GeneratedRule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedRule"
  ADD CONSTRAINT "GeneratedRule_attackTechniqueId_fkey"
  FOREIGN KEY ("attackTechniqueId") REFERENCES "AttackTechnique"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
