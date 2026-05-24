-- Multi-tenant migration.
--
-- Adds Organization + OrgInvite, scopes every tenant-owned model with
-- organizationId, swaps previously-global unique constraints for compound
-- per-tenant ones, and backfills all existing data into a default
-- "Acme Corp" organization. A second "Relay Platform" organization is
-- created up-front to host platform-admin accounts.

-- ── 1. Tenancy tables ────────────────────────────────────────────────

CREATE TABLE "Organization" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "settings"    JSONB NOT NULL DEFAULT '{}',
    "suspendedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TABLE "OrgInvite" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email"          TEXT NOT NULL,
    "role"           "Role" NOT NULL,
    "token"          TEXT NOT NULL,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "acceptedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgInvite_token_key" ON "OrgInvite"("token");
CREATE INDEX "OrgInvite_organizationId_idx" ON "OrgInvite"("organizationId");
CREATE INDEX "OrgInvite_email_idx" ON "OrgInvite"("email");

-- ── 2. Default orgs ─────────────────────────────────────────────────
--
-- All existing rows land in Acme Corp (slug "acme"). The Relay Platform
-- org (slug "relay") exists to host platform-admin accounts; it has no
-- tickets, devices, etc.

INSERT INTO "Organization" ("id", "name", "slug", "settings", "createdAt") VALUES
  ('org_acme_legacy_default',    'Acme Corp',      'acme',  '{}', NOW()),
  ('org_relay_platform_default', 'Relay Platform', 'relay', '{}', NOW());

-- ── 3. Add organizationId nullable + isPlatformAdmin ────────────────

ALTER TABLE "User"             ADD COLUMN "organizationId"  TEXT;
ALTER TABLE "User"             ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket"           ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Comment"          ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Attachment"       ADD COLUMN "organizationId" TEXT;
ALTER TABLE "SurveyResponse"   ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Device"           ADD COLUMN "organizationId" TEXT;
ALTER TABLE "RemoteSession"    ADD COLUMN "organizationId" TEXT;
ALTER TABLE "KbArticle"        ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ServiceComponent" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Incident"         ADD COLUMN "organizationId" TEXT;

-- ── 4. Backfill existing rows → Acme Corp ───────────────────────────

UPDATE "User"             SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "Ticket"           SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "Comment"          SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "Attachment"       SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "SurveyResponse"   SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "Device"           SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "RemoteSession"    SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "KbArticle"        SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "ServiceComponent" SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "Incident"         SET "organizationId" = 'org_acme_legacy_default' WHERE "organizationId" IS NULL;

-- ── 5. Drop old global unique indexes ───────────────────────────────

DROP INDEX IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "Ticket_refCode_key";
DROP INDEX IF EXISTS "Device_hostname_key";
DROP INDEX IF EXISTS "ServiceComponent_name_key";

-- ── 6. Drop single-column indexes being promoted to compound ────────

DROP INDEX IF EXISTS "Ticket_status_idx";
DROP INDEX IF EXISTS "Ticket_priority_idx";
DROP INDEX IF EXISTS "Ticket_submitterEmail_idx";
DROP INDEX IF EXISTS "Ticket_slaDueAt_idx";
DROP INDEX IF EXISTS "Comment_ticketId_idx";
DROP INDEX IF EXISTS "Attachment_ticketId_idx";
DROP INDEX IF EXISTS "Device_healthStatus_idx";
DROP INDEX IF EXISTS "RemoteSession_deviceId_idx";
DROP INDEX IF EXISTS "RemoteSession_agentId_idx";
DROP INDEX IF EXISTS "KbArticle_category_idx";
DROP INDEX IF EXISTS "Incident_status_idx";
DROP INDEX IF EXISTS "Incident_componentId_idx";

-- ── 7. NOT NULL the organizationId columns ──────────────────────────

ALTER TABLE "User"             ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Ticket"           ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Comment"          ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Attachment"       ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "SurveyResponse"   ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Device"           ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "RemoteSession"    ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "KbArticle"        ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ServiceComponent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Incident"         ALTER COLUMN "organizationId" SET NOT NULL;

-- ── 8. New compound uniques ─────────────────────────────────────────

CREATE UNIQUE INDEX "User_organizationId_email_key"              ON "User"("organizationId", "email");
CREATE UNIQUE INDEX "Ticket_organizationId_refCode_key"          ON "Ticket"("organizationId", "refCode");
CREATE UNIQUE INDEX "Device_organizationId_hostname_key"         ON "Device"("organizationId", "hostname");
CREATE UNIQUE INDEX "ServiceComponent_organizationId_name_key"   ON "ServiceComponent"("organizationId", "name");

-- ── 9. New compound indexes (replacements + new) ────────────────────

CREATE INDEX "Ticket_organizationId_status_idx"          ON "Ticket"("organizationId", "status");
CREATE INDEX "Ticket_organizationId_priority_idx"        ON "Ticket"("organizationId", "priority");
CREATE INDEX "Ticket_organizationId_submitterEmail_idx"  ON "Ticket"("organizationId", "submitterEmail");
CREATE INDEX "Ticket_organizationId_slaDueAt_idx"        ON "Ticket"("organizationId", "slaDueAt");
CREATE INDEX "Comment_organizationId_ticketId_idx"       ON "Comment"("organizationId", "ticketId");
CREATE INDEX "Attachment_organizationId_ticketId_idx"    ON "Attachment"("organizationId", "ticketId");
CREATE INDEX "Device_organizationId_healthStatus_idx"    ON "Device"("organizationId", "healthStatus");
CREATE INDEX "RemoteSession_organizationId_deviceId_idx" ON "RemoteSession"("organizationId", "deviceId");
CREATE INDEX "RemoteSession_organizationId_agentId_idx"  ON "RemoteSession"("organizationId", "agentId");
CREATE INDEX "KbArticle_organizationId_category_idx"     ON "KbArticle"("organizationId", "category");
CREATE INDEX "Incident_organizationId_status_idx"        ON "Incident"("organizationId", "status");
CREATE INDEX "Incident_organizationId_componentId_idx"   ON "Incident"("organizationId", "componentId");

-- ── 10. Foreign keys to Organization (ON DELETE CASCADE) ────────────

ALTER TABLE "User"             ADD CONSTRAINT "User_organizationId_fkey"             FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgInvite"        ADD CONSTRAINT "OrgInvite_organizationId_fkey"        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ticket"           ADD CONSTRAINT "Ticket_organizationId_fkey"           FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment"          ADD CONSTRAINT "Comment_organizationId_fkey"          FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment"       ADD CONSTRAINT "Attachment_organizationId_fkey"       FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SurveyResponse"   ADD CONSTRAINT "SurveyResponse_organizationId_fkey"   FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Device"           ADD CONSTRAINT "Device_organizationId_fkey"           FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteSession"    ADD CONSTRAINT "RemoteSession_organizationId_fkey"    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KbArticle"        ADD CONSTRAINT "KbArticle_organizationId_fkey"        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceComponent" ADD CONSTRAINT "ServiceComponent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident"         ADD CONSTRAINT "Incident_organizationId_fkey"         FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
