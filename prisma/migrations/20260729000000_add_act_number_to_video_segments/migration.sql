ALTER TABLE "VideoSegment" ADD COLUMN IF NOT EXISTS "act_number" INTEGER;

CREATE INDEX IF NOT EXISTS "VideoSegment_project_id_step_name_act_number_shot_id_idx"
  ON "VideoSegment"("project_id", "step_name", "act_number", "shot_id");
