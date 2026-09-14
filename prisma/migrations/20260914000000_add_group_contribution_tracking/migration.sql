-- Normalize the business target and adoption state used by group contribution reports.
ALTER TABLE "OperationLog"
  ADD COLUMN IF NOT EXISTS "scopeType" TEXT,
  ADD COLUMN IF NOT EXISTS "scopeKey" TEXT;

ALTER TABLE "OperationResult"
  ADD COLUMN IF NOT EXISTS "targetType" TEXT,
  ADD COLUMN IF NOT EXISTS "targetKey" TEXT,
  ADD COLUMN IF NOT EXISTS "targetLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "shotId" TEXT,
  ADD COLUMN IF NOT EXISTS "actNumber" INTEGER,
  ADD COLUMN IF NOT EXISTS "adoptionStatus" TEXT NOT NULL DEFAULT 'GENERATED',
  ADD COLUMN IF NOT EXISTS "adoptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "adoptedById" TEXT;

CREATE INDEX IF NOT EXISTS "OperationLog_projectId_scopeType_scopeKey_idx"
  ON "OperationLog"("projectId", "scopeType", "scopeKey");
CREATE INDEX IF NOT EXISTS "OperationResult_targetType_targetKey_idx"
  ON "OperationResult"("targetType", "targetKey");
CREATE INDEX IF NOT EXISTS "OperationResult_adoptionStatus_createdAt_idx"
  ON "OperationResult"("adoptionStatus", "createdAt");

-- Backfill normalized shot dimensions from the immutable result metadata snapshot.
UPDATE "OperationResult"
SET
  "targetType" = COALESCE("targetType", 'SHOT'),
  "shotId" = COALESCE("shotId", "metadata"->>'shotId'),
  "actNumber" = COALESCE(
    "actNumber",
    CASE
      WHEN ("metadata"->>'actNumber') ~ '^[0-9]+$'
      THEN ("metadata"->>'actNumber')::INTEGER
      ELSE NULL
    END
  ),
  "targetKey" = COALESCE(
    "targetKey",
    CASE
      WHEN "metadata"->>'shotId' IS NOT NULL
      THEN 'act:' || COALESCE("metadata"->>'actNumber', '0') || '/shot:' || ("metadata"->>'shotId')
      ELSE NULL
    END
  )
WHERE "metadata"->>'shotId' IS NOT NULL;
