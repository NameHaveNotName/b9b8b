ALTER TYPE "UserAssetKind" ADD VALUE IF NOT EXISTS 'STYLE';
ALTER TYPE "UserAssetKind" ADD VALUE IF NOT EXISTS 'OBJECT';
ALTER TYPE "UserAssetKind" ADD VALUE IF NOT EXISTS 'BRAND';
ALTER TYPE "UserAssetSource" ADD VALUE IF NOT EXISTS 'PROJECT';

CREATE TABLE IF NOT EXISTS "asset_bindings" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_asset_id" TEXT,
  "asset_id" TEXT,
  "target_type" TEXT NOT NULL,
  "target_key" TEXT NOT NULL,
  "reference_role" TEXT NOT NULL DEFAULT 'GENERAL',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_bindings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "asset_bindings_user_asset_id_fkey" FOREIGN KEY ("user_asset_id") REFERENCES "user_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "asset_bindings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "asset_bindings_project_target_enabled_idx"
ON "asset_bindings"("project_id", "target_type", "target_key", "enabled");

CREATE INDEX IF NOT EXISTS "asset_bindings_user_asset_id_idx"
ON "asset_bindings"("user_asset_id");

CREATE INDEX IF NOT EXISTS "asset_bindings_asset_id_idx"
ON "asset_bindings"("asset_id");
