-- CreateTable
CREATE TABLE "voiceover_segments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "shot_id" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "speaker" TEXT,
    "audio_url" TEXT,
    "storage_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sequence" INTEGER NOT NULL,
    "duration" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voiceover_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voiceover_segments_project_id_status_idx" ON "voiceover_segments"("project_id", "status");

-- CreateIndex
CREATE INDEX "voiceover_segments_project_id_step_name_idx" ON "voiceover_segments"("project_id", "step_name");

-- CreateIndex
CREATE INDEX "voiceover_segments_project_id_sequence_idx" ON "voiceover_segments"("project_id", "sequence");

-- CreateIndex
CREATE INDEX "voiceover_segments_project_id_shot_id_idx" ON "voiceover_segments"("project_id", "shot_id");

-- AddForeignKey
ALTER TABLE "voiceover_segments" ADD CONSTRAINT "voiceover_segments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
