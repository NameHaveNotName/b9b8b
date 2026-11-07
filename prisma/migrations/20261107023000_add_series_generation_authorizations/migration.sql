ALTER TABLE "series_batch_approvals"
ADD COLUMN "consumed_points" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "series_generation_authorizations" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "approval_id" TEXT,
    "operation_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "series_generation_authorizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "series_generation_authorizations_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "series_generation_authorizations_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "series_batch_approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "series_generation_authorizations_operation_id_key" ON "series_generation_authorizations"("operation_id");
CREATE INDEX "series_generation_authorizations_series_id_status_created_at_idx" ON "series_generation_authorizations"("series_id", "status", "created_at");
CREATE INDEX "series_generation_authorizations_approval_id_status_idx" ON "series_generation_authorizations"("approval_id", "status");
CREATE INDEX "series_generation_authorizations_user_id_status_idx" ON "series_generation_authorizations"("user_id", "status");
