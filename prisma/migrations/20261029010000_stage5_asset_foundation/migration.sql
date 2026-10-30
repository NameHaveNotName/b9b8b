ALTER TYPE "UserAssetKind" ADD VALUE IF NOT EXISTS 'STORY';
ALTER TYPE "UserAssetKind" ADD VALUE IF NOT EXISTS 'TEXT';
ALTER TYPE "UserAssetSource" ADD VALUE IF NOT EXISTS 'IMPORT';
ALTER TYPE "UserAssetSource" ADD VALUE IF NOT EXISTS 'MANUAL';

DO $$ BEGIN
  CREATE TYPE "UserAssetContentType" AS ENUM (
    'IMAGE', 'VIDEO', 'AUDIO', 'TEXT', 'CHARACTER_CARD',
    'ENVIRONMENT_SETTING', 'STORY_TEMPLATE', 'STYLE_GUIDE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "user_assets"
  ADD COLUMN IF NOT EXISTS "content_type" "UserAssetContentType" NOT NULL DEFAULT 'IMAGE',
  ADD COLUMN IF NOT EXISTS "schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "structured_payload" JSONB,
  ADD COLUMN IF NOT EXISTS "current_revision_id" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purge_after" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_id" TEXT;

CREATE TABLE IF NOT EXISTS "user_asset_revisions" (
  "id" TEXT NOT NULL,
  "user_asset_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "content_type" "UserAssetContentType" NOT NULL DEFAULT 'IMAGE',
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "structured_payload" JSONB,
  "mime_type" TEXT,
  "storage_key" TEXT,
  "content_hash" TEXT,
  "prompt_snapshot" TEXT,
  "generation_snapshot" JSONB,
  "parent_revision_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_asset_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_asset_revisions_user_asset_id_fkey" FOREIGN KEY ("user_asset_id") REFERENCES "user_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_asset_revisions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_asset_revisions_asset_revision_key"
  ON "user_asset_revisions"("user_asset_id", "revision_number");
CREATE INDEX IF NOT EXISTS "user_asset_revisions_owner_created_idx"
  ON "user_asset_revisions"("owner_id", "created_at");
CREATE INDEX IF NOT EXISTS "user_asset_revisions_content_hash_idx"
  ON "user_asset_revisions"("content_hash");

CREATE TABLE IF NOT EXISTS "user_asset_attachments" (
  "id" TEXT NOT NULL,
  "revision_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'PRIMARY',
  "position" INTEGER NOT NULL DEFAULT 0,
  "mime_type" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "content_hash" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_asset_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_asset_attachments_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "user_asset_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_asset_attachments_revision_position_idx"
  ON "user_asset_attachments"("revision_id", "position");
CREATE INDEX IF NOT EXISTS "user_asset_attachments_content_hash_idx"
  ON "user_asset_attachments"("content_hash");

INSERT INTO "user_asset_revisions" (
  "id", "user_asset_id", "owner_id", "revision_number", "content_type",
  "schema_version", "mime_type", "storage_key", "prompt_snapshot",
  "generation_snapshot", "created_at"
)
SELECT
  'legacy_' || md5(ua."id"), ua."id", ua."user_id", 1, 'IMAGE', 1,
  ua."mime_type", ua."storage_key", ua."prompt", ua."metadata", ua."created_at"
FROM "user_assets" ua
ON CONFLICT ("user_asset_id", "revision_number") DO NOTHING;

INSERT INTO "user_asset_attachments" (
  "id", "revision_id", "role", "position", "mime_type", "storage_key", "created_at"
)
SELECT
  'legacy_attachment_' || md5(ua."id"), 'legacy_' || md5(ua."id"),
  'PRIMARY', 0, ua."mime_type", ua."storage_key", ua."created_at"
FROM "user_assets" ua
ON CONFLICT ("id") DO NOTHING;

UPDATE "user_assets" ua
SET "current_revision_id" = rev."id"
FROM "user_asset_revisions" rev
WHERE rev."user_asset_id" = ua."id"
  AND rev."revision_number" = 1
  AND ua."current_revision_id" IS NULL;

CREATE INDEX IF NOT EXISTS "user_assets_user_deleted_created_idx"
  ON "user_assets"("user_id", "deleted_at", "created_at");

ALTER TABLE "Asset"
  ADD COLUMN IF NOT EXISTS "content_type" "UserAssetContentType" NOT NULL DEFAULT 'IMAGE',
  ADD COLUMN IF NOT EXISTS "schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "structured_payload" JSONB,
  ADD COLUMN IF NOT EXISTS "source_user_asset_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_user_asset_revision_id" TEXT,
  ADD COLUMN IF NOT EXISTS "content_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purge_after" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "purge_completed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Asset_projectId_deleted_at_createdAt_idx"
  ON "Asset"("projectId", "deleted_at", "createdAt");
CREATE INDEX IF NOT EXISTS "Asset_source_user_asset_revision_id_idx"
  ON "Asset"("source_user_asset_revision_id");
CREATE UNIQUE INDEX IF NOT EXISTS "Asset_projectId_source_user_asset_revision_id_key"
  ON "Asset"("projectId", "source_user_asset_revision_id");

COMMENT ON COLUMN "Asset"."source_user_asset_id" IS 'Lineage only. Project runtime must never resolve the personal library row.';

CREATE TABLE IF NOT EXISTS "project_asset_constraints" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "target_step" "WorkflowStepType" NOT NULL,
  "target_key" TEXT NOT NULL DEFAULT '',
  "interpretation" TEXT NOT NULL DEFAULT 'CONSTRAINTS',
  "strength" TEXT NOT NULL DEFAULT 'SOFT',
  "scope" TEXT NOT NULL DEFAULT 'STEP',
  "merge_strategy" TEXT NOT NULL DEFAULT 'ADD',
  "selected_fields" JSONB,
  "payload_snapshot" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_asset_constraints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_asset_constraints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_asset_constraints_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_asset_constraints_project_asset_step_target_key"
  ON "project_asset_constraints"("project_id", "asset_id", "target_step", "target_key");
CREATE INDEX IF NOT EXISTS "project_asset_constraints_project_step_enabled_idx"
  ON "project_asset_constraints"("project_id", "target_step", "enabled");
CREATE INDEX IF NOT EXISTS "project_asset_constraints_asset_id_idx"
  ON "project_asset_constraints"("asset_id");
