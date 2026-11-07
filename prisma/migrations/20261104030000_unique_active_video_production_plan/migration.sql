-- A project step may have many drafts and archived revisions, but only one active plan.
-- Abort instead of silently modifying data if legacy duplicates ever exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "video_production_plans"
    WHERE "status" = 'ACTIVE'
    GROUP BY "project_id", "step_name"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate ACTIVE video production plans must be resolved before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "video_production_plans_one_active_per_step"
ON "video_production_plans" ("project_id", "step_name")
WHERE "status" = 'ACTIVE';
