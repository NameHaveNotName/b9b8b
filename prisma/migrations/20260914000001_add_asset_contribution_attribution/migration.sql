ALTER TABLE "Asset"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'GENERATED';

ALTER TABLE "VideoSegment"
  ADD COLUMN IF NOT EXISTS "created_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "Asset_createdById_createdAt_idx"
  ON "Asset"("createdById", "createdAt");
CREATE INDEX IF NOT EXISTS "VideoSegment_createdById_createdAt_idx"
  ON "VideoSegment"("created_by_id", "created_at");

-- Prefer the actor captured by the immutable operation ledger.
UPDATE "Asset" AS asset
SET "createdById" = operation."userId"
FROM "OperationResult" AS result
JOIN "OperationLog" AS operation ON operation."id" = result."operationId"
WHERE result."assetId" = asset."id"
  AND asset."createdById" IS NULL;

-- Older generation routes stored the result directly on OperationLog.assetId.
UPDATE "Asset" AS asset
SET "createdById" = operation."userId"
FROM "OperationLog" AS operation
WHERE operation."assetId" = asset."id"
  AND asset."createdById" IS NULL;

-- Imported storyboard images did not historically have an operation row. Their
-- best recoverable owner is the project creator; new imports record the actor exactly.
UPDATE "Asset" AS asset
SET
  "createdById" = project."userId"
FROM "Project" AS project
WHERE project."id" = asset."projectId"
  AND asset."createdById" IS NULL;

UPDATE "Asset"
SET "origin" = 'IMPORTED'
WHERE "metadata"->>'source' = 'storyboard-import';

UPDATE "VideoSegment" AS segment
SET "created_by_id" = COALESCE(
  (
    SELECT operation."userId"
    FROM "OperationResult" AS result
    JOIN "OperationLog" AS operation ON operation."id" = result."operationId"
    WHERE result."videoSegmentId" = segment."id"
    ORDER BY result."createdAt" DESC
    LIMIT 1
  ),
  project."userId"
)
FROM "Project" AS project
WHERE project."id" = segment."project_id"
  AND segment."created_by_id" IS NULL;
