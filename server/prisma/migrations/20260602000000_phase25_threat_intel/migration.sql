-- Phase 25 — Threat intelligence (CISA KEV, NVD, GHSA, RSS feeds).

CREATE TYPE "ThreatKind" AS ENUM (
  'CVE', 'KEV', 'IOC_IP', 'IOC_DOMAIN', 'IOC_HASH', 'NEWS', 'ADVISORY'
);
CREATE TYPE "ThreatSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "ThreatMatchStatus" AS ENUM (
  'OPEN', 'ACKNOWLEDGED', 'CONVERTED_TO_TICKET', 'DISMISSED'
);

CREATE TABLE "ThreatIntel" (
    "id"              TEXT NOT NULL,
    "kind"            "ThreatKind" NOT NULL,
    "source"          TEXT NOT NULL,
    "externalId"      TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "description"     TEXT NOT NULL,
    "severity"        "ThreatSeverity" NOT NULL DEFAULT 'MEDIUM',
    "cvss"            DOUBLE PRECISION,
    "references"      JSONB NOT NULL DEFAULT '[]',
    "affected"        JSONB NOT NULL DEFAULT '[]',
    "kevMetadata"     JSONB,
    "publishedAt"     TIMESTAMP(3) NOT NULL,
    "ingestedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ThreatIntel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreatIntel_source_externalId_key"
  ON "ThreatIntel"("source", "externalId");
CREATE INDEX "ThreatIntel_kind_severity_idx"     ON "ThreatIntel"("kind", "severity");
CREATE INDEX "ThreatIntel_publishedAt_idx"       ON "ThreatIntel"("publishedAt");

CREATE TABLE "ThreatMatch" (
    "id"               TEXT NOT NULL,
    "organizationId"   TEXT NOT NULL,
    "threatIntelId"    TEXT NOT NULL,
    "reason"           TEXT NOT NULL,
    "evidence"         JSONB NOT NULL DEFAULT '{}',
    "status"           "ThreatMatchStatus" NOT NULL DEFAULT 'OPEN',
    "acknowledgedAt"   TIMESTAMP(3),
    "acknowledgedBy"   TEXT,
    "resultingTicketId" TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ThreatMatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreatMatch_organizationId_threatIntelId_reason_key"
  ON "ThreatMatch"("organizationId", "threatIntelId", "reason");
CREATE INDEX "ThreatMatch_organizationId_status_createdAt_idx"
  ON "ThreatMatch"("organizationId", "status", "createdAt");

ALTER TABLE "ThreatMatch"
  ADD CONSTRAINT "ThreatMatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreatMatch"
  ADD CONSTRAINT "ThreatMatch_threatIntelId_fkey"
  FOREIGN KEY ("threatIntelId") REFERENCES "ThreatIntel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
