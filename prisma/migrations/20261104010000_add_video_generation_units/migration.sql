-- 2.0 video production core: separate supplier requests, returned clips, and edit timeline.
-- This migration is additive. Existing VideoSegment rows remain the compatibility source.

CREATE TABLE IF NOT EXISTS "video_production_plans" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "step_name" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "model_policy" JSONB,
  "quality_policy" JSONB,
  "requested_duration_ms" INTEGER NOT NULL DEFAULT 0,
  "billable_duration_ms" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost_usd" DOUBLE PRECISION,
  "expected_usable_cost_usd" DOUBLE PRECISION,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_production_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "video_production_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "generation_units" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "plan_id" TEXT,
  "step_name" TEXT NOT NULL,
  "strategy" TEXT NOT NULL DEFAULT 'SINGLE_SHOT',
  "status" TEXT NOT NULL DEFAULT 'planned',
  "tier" TEXT,
  "model_id" TEXT,
  "prompt" TEXT NOT NULL,
  "requested_duration_ms" INTEGER NOT NULL,
  "billable_duration_ms" INTEGER,
  "reference_assets" JSONB,
  "estimated_cost_usd" DOUBLE PRECISION,
  "actual_cost_usd" DOUBLE PRECISION,
  "provider_task_id" TEXT,
  "error_message" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "generation_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "generation_units_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "generation_units_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "video_production_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "generation_unit_items" (
  "id" TEXT NOT NULL,
  "generation_unit_id" TEXT NOT NULL,
  "legacy_segment_id" TEXT,
  "shot_id" TEXT NOT NULL,
  "act_number" INTEGER,
  "sequence" INTEGER NOT NULL,
  "planned_duration_ms" INTEGER NOT NULL,
  "prompt" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "generation_unit_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "generation_unit_items_generation_unit_id_fkey" FOREIGN KEY ("generation_unit_id") REFERENCES "generation_units"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "generation_unit_items_legacy_segment_id_fkey" FOREIGN KEY ("legacy_segment_id") REFERENCES "VideoSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "generated_clips" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "generation_unit_id" TEXT NOT NULL,
  "model_id" TEXT,
  "provider_task_id" TEXT,
  "video_url" TEXT,
  "storage_key" TEXT,
  "duration_ms" INTEGER NOT NULL,
  "is_mock" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "generated_clips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "generated_clips_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "generated_clips_generation_unit_id_fkey" FOREIGN KEY ("generation_unit_id") REFERENCES "generation_units"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "timeline_segments" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "plan_id" TEXT,
  "step_name" TEXT NOT NULL,
  "generation_unit_id" TEXT NOT NULL,
  "generated_clip_id" TEXT,
  "sequence" INTEGER NOT NULL,
  "source_start_ms" INTEGER NOT NULL DEFAULT 0,
  "source_end_ms" INTEGER NOT NULL,
  "timeline_start_ms" INTEGER NOT NULL,
  "timeline_end_ms" INTEGER NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "transition" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "timeline_segments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "timeline_segments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timeline_segments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "video_production_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timeline_segments_generation_unit_id_fkey" FOREIGN KEY ("generation_unit_id") REFERENCES "generation_units"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timeline_segments_generated_clip_id_fkey" FOREIGN KEY ("generated_clip_id") REFERENCES "generated_clips"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "timeline_segments_duration_check" CHECK ("duration_ms" > 0 AND "source_end_ms" > "source_start_ms" AND "timeline_end_ms" > "timeline_start_ms")
);

CREATE TABLE IF NOT EXISTS "video_quality_assessments" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "generated_clip_id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'STATIC',
  "decision" TEXT NOT NULL,
  "overall_score" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "scores" JSONB NOT NULL,
  "signals" JSONB,
  "reasons" JSONB NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "video_quality_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "video_quality_assessments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "video_quality_assessments_generated_clip_id_fkey" FOREIGN KEY ("generated_clip_id") REFERENCES "generated_clips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "video_production_plans_project_step_status_created_idx" ON "video_production_plans"("project_id", "step_name", "status", "created_at");
CREATE INDEX IF NOT EXISTS "generation_units_project_step_status_idx" ON "generation_units"("project_id", "step_name", "status");
CREATE INDEX IF NOT EXISTS "generation_units_plan_status_idx" ON "generation_units"("plan_id", "status");
CREATE INDEX IF NOT EXISTS "generation_units_project_created_idx" ON "generation_units"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "generation_units_provider_task_idx" ON "generation_units"("provider_task_id");
CREATE UNIQUE INDEX IF NOT EXISTS "generation_unit_items_unit_sequence_key" ON "generation_unit_items"("generation_unit_id", "sequence");
CREATE INDEX IF NOT EXISTS "generation_unit_items_legacy_segment_idx" ON "generation_unit_items"("legacy_segment_id");
CREATE INDEX IF NOT EXISTS "generation_unit_items_shot_act_idx" ON "generation_unit_items"("shot_id", "act_number");
CREATE INDEX IF NOT EXISTS "generated_clips_project_created_idx" ON "generated_clips"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "generated_clips_unit_created_idx" ON "generated_clips"("generation_unit_id", "created_at");
CREATE INDEX IF NOT EXISTS "generated_clips_provider_task_idx" ON "generated_clips"("provider_task_id");
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_segments_plan_sequence_key" ON "timeline_segments"("plan_id", "sequence");
CREATE INDEX IF NOT EXISTS "timeline_segments_project_step_sequence_idx" ON "timeline_segments"("project_id", "step_name", "sequence");
CREATE INDEX IF NOT EXISTS "timeline_segments_generated_clip_idx" ON "timeline_segments"("generated_clip_id");
CREATE INDEX IF NOT EXISTS "timeline_segments_generation_unit_idx" ON "timeline_segments"("generation_unit_id");
CREATE INDEX IF NOT EXISTS "timeline_segments_project_step_start_idx" ON "timeline_segments"("project_id", "step_name", "timeline_start_ms");
CREATE INDEX IF NOT EXISTS "video_quality_assessments_clip_created_idx" ON "video_quality_assessments"("generated_clip_id", "created_at");
CREATE INDEX IF NOT EXISTS "video_quality_assessments_project_decision_created_idx" ON "video_quality_assessments"("project_id", "decision", "created_at");
