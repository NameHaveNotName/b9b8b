-- The product workflow now has nine steps. Remove the three retired step rows
-- before narrowing the PostgreSQL enum so existing projects can migrate safely.
DELETE FROM "WorkflowStep"
WHERE "stepType" IN ('VIDEO_RENDER', 'CAMERA', 'REVIEW');

ALTER TYPE "WorkflowStepType" RENAME TO "WorkflowStepType_old";

CREATE TYPE "WorkflowStepType" AS ENUM (
  'IDEATION',
  'FRAMEWORK',
  'STYLE',
  'CHARACTER',
  'CONCEPT',
  'TRAILER',
  'STORYBOARD',
  'KEYFRAMES',
  'VIDEO_DIRECT'
);

ALTER TABLE "WorkflowStep"
  ALTER COLUMN "stepType" TYPE "WorkflowStepType"
  USING ("stepType"::text::"WorkflowStepType");

DROP TYPE "WorkflowStepType_old";
