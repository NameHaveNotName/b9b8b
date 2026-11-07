CREATE TABLE "series_assets" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "source_user_asset_id" TEXT,
    "source_user_asset_revision_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "kind" "UserAssetKind" NOT NULL,
    "content_type" "UserAssetContentType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "structured_payload" JSONB,
    "content_hash" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "series_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_assets_series_id_source_user_asset_revision_id_key" ON "series_assets"("series_id", "source_user_asset_revision_id");
CREATE INDEX "series_assets_series_id_enabled_created_at_idx" ON "series_assets"("series_id", "enabled", "created_at");
CREATE INDEX "series_assets_source_user_asset_id_idx" ON "series_assets"("source_user_asset_id");
CREATE INDEX "series_assets_source_user_asset_revision_id_idx" ON "series_assets"("source_user_asset_revision_id");

ALTER TABLE "series_assets" ADD CONSTRAINT "series_assets_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_assets" ADD CONSTRAINT "series_assets_source_user_asset_id_fkey" FOREIGN KEY ("source_user_asset_id") REFERENCES "user_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "series_assets" ADD CONSTRAINT "series_assets_source_user_asset_revision_id_fkey" FOREIGN KEY ("source_user_asset_revision_id") REFERENCES "user_asset_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "series_assets" ADD CONSTRAINT "series_assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
