-- Phase 7 — asset auto-discovery agent.
--
-- Adds the DiscoverySource enum, three Device columns (discoverySource,
-- agentVersion, lastCheckInAt), the DeviceMetric time-series table, and
-- the AgentEnrollmentToken table for per-org agent authentication.

-- ── 1. Enum ──────────────────────────────────────────────────────────

CREATE TYPE "DiscoverySource" AS ENUM ('MANUAL', 'AGENT');

-- ── 2. Device columns ───────────────────────────────────────────────

ALTER TABLE "Device" ADD COLUMN "discoverySource" "DiscoverySource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Device" ADD COLUMN "agentVersion"    TEXT;
ALTER TABLE "Device" ADD COLUMN "lastCheckInAt"   TIMESTAMP(3);

-- ── 3. DeviceMetric ──────────────────────────────────────────────────

CREATE TABLE "DeviceMetric" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId"       TEXT NOT NULL,
    "cpu"            INTEGER NOT NULL,
    "ram"            INTEGER NOT NULL,
    "disk"           INTEGER NOT NULL,
    "recordedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceMetric_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeviceMetric_organizationId_deviceId_recordedAt_idx" ON "DeviceMetric"("organizationId", "deviceId", "recordedAt");

ALTER TABLE "DeviceMetric" ADD CONSTRAINT "DeviceMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceMetric" ADD CONSTRAINT "DeviceMetric_deviceId_fkey"       FOREIGN KEY ("deviceId")       REFERENCES "Device"("id")       ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. AgentEnrollmentToken ─────────────────────────────────────────

CREATE TABLE "AgentEnrollmentToken" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token"          TEXT NOT NULL,
    "label"          TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"      TIMESTAMP(3),
    "lastUsedAt"     TIMESTAMP(3),
    CONSTRAINT "AgentEnrollmentToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentEnrollmentToken_token_key"          ON "AgentEnrollmentToken"("token");
CREATE INDEX        "AgentEnrollmentToken_organizationId_idx" ON "AgentEnrollmentToken"("organizationId");

ALTER TABLE "AgentEnrollmentToken" ADD CONSTRAINT "AgentEnrollmentToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
