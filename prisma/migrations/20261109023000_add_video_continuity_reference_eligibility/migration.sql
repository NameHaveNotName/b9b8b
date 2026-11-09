ALTER TABLE "video_evidence_packages"
ADD COLUMN "continuity_reference_status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "continuity_anchor_storage_key" TEXT,
ADD COLUMN "continuity_anchor_time_ms" INTEGER,
ADD COLUMN "continuity_reference_note" TEXT,
ADD COLUMN "continuity_reviewed_by_id" TEXT,
ADD COLUMN "continuity_reviewed_at" TIMESTAMP(3);
