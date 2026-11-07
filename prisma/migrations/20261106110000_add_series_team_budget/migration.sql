ALTER TABLE "story_series"
  ADD COLUMN "monthly_point_budget" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "batch_generation_limit" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "require_batch_approval" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "series_memberships" (
  "id" TEXT NOT NULL,
  "series_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "assigned_episode_ids" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "series_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "series_batch_approvals" (
  "id" TEXT NOT NULL,
  "series_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "reviewed_by_id" TEXT,
  "episode_ids" JSONB NOT NULL,
  "requested_points" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decision_note" TEXT,
  "expires_at" TIMESTAMP(3),
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "series_batch_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_memberships_series_id_user_id_key" ON "series_memberships"("series_id", "user_id");
CREATE INDEX "series_memberships_user_id_status_idx" ON "series_memberships"("user_id", "status");
CREATE INDEX "series_batch_approvals_series_id_status_created_at_idx" ON "series_batch_approvals"("series_id", "status", "created_at");
CREATE INDEX "series_batch_approvals_requested_by_id_status_idx" ON "series_batch_approvals"("requested_by_id", "status");

ALTER TABLE "series_memberships" ADD CONSTRAINT "series_memberships_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_memberships" ADD CONSTRAINT "series_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_batch_approvals" ADD CONSTRAINT "series_batch_approvals_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_batch_approvals" ADD CONSTRAINT "series_batch_approvals_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_batch_approvals" ADD CONSTRAINT "series_batch_approvals_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
