CREATE TABLE "video_evidence_packages" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "generated_clip_id" TEXT NOT NULL,
    "contact_sheet_storage_key" TEXT,
    "contact_sheet_frame_times_ms" JSONB NOT NULL DEFAULT '[]',
    "contact_sheet_status" TEXT NOT NULL DEFAULT 'PENDING',
    "contact_sheet_error" TEXT,
    "technical_evidence" JSONB,
    "disposition" TEXT NOT NULL DEFAULT 'PENDING',
    "usable_start_ms" INTEGER,
    "usable_end_ms" INTEGER,
    "review_note" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_evidence_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_evidence_packages_generated_clip_id_key"
ON "video_evidence_packages"("generated_clip_id");

CREATE INDEX "video_evidence_packages_project_disposition_updated_idx"
ON "video_evidence_packages"("project_id", "disposition", "updated_at");

ALTER TABLE "video_evidence_packages"
ADD CONSTRAINT "video_evidence_packages_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "video_evidence_packages"
ADD CONSTRAINT "video_evidence_packages_generated_clip_id_fkey"
FOREIGN KEY ("generated_clip_id") REFERENCES "generated_clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
