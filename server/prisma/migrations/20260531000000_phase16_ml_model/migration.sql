-- Phase 16 — learned ML models trained from RemediationOutcome history.

CREATE TABLE "MlModel" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "modelKey"       TEXT NOT NULL,
    "version"        INTEGER NOT NULL,
    "active"         BOOLEAN NOT NULL DEFAULT false,
    "weights"        JSONB NOT NULL,
    "metrics"        JSONB NOT NULL DEFAULT '{}',
    "trainedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MlModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MlModel_organizationId_modelKey_version_key"
  ON "MlModel"("organizationId", "modelKey", "version");
CREATE INDEX "MlModel_organizationId_modelKey_active_idx"
  ON "MlModel"("organizationId", "modelKey", "active");

ALTER TABLE "MlModel"
  ADD CONSTRAINT "MlModel_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
