-- Additive supplier-operation ledger. Existing OperationLog rows remain readable.
ALTER TABLE "OperationLog"
  ADD COLUMN IF NOT EXISTS "actionKey" TEXT NOT NULL DEFAULT 'generation.unknown',
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  ADD COLUMN IF NOT EXISTS "stepName" TEXT,
  ADD COLUMN IF NOT EXISTS "providerCost" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "currency" TEXT,
  ADD COLUMN IF NOT EXISTS "costSource" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "inputSummary" JSONB,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "errorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "durationMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "OperationLog"
SET "status" = CASE WHEN "success" THEN 'SUCCEEDED' ELSE 'FAILED' END,
    "completedAt" = COALESCE("completedAt", "createdAt"),
    "startedAt" = COALESCE("startedAt", "createdAt"),
    "actionKey" = CASE WHEN "type" = 'regenerate' THEN 'generation.regenerate' WHEN "type" = 'error' THEN 'generation.failed' ELSE 'generation.generate' END
WHERE "actionKey" = 'generation.unknown';

CREATE TABLE IF NOT EXISTS "ProviderCallAttempt" (
  "id" TEXT NOT NULL, "operationId" TEXT NOT NULL, "provider" TEXT NOT NULL,
  "model" TEXT, "endpoint" TEXT NOT NULL, "method" TEXT NOT NULL DEFAULT 'POST',
  "attemptNo" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "externalTaskId" TEXT, "requestId" TEXT, "httpStatus" INTEGER,
  "pollCount" INTEGER NOT NULL DEFAULT 0, "providerCost" DECIMAL(18,8),
  "currency" TEXT, "costSource" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "errorCode" TEXT, "errorMessage" TEXT, "metadata" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3), "durationMs" INTEGER,
  CONSTRAINT "ProviderCallAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderCallAttempt_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "OperationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "OperationResult" (
  "id" TEXT NOT NULL, "operationId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "title" TEXT, "assetId" TEXT, "userAssetId" TEXT, "videoSegmentId" TEXT,
  "voiceoverSegmentId" TEXT, "storageKey" TEXT, "mimeType" TEXT,
  "externalUrl" TEXT, "isMock" BOOLEAN NOT NULL DEFAULT false, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationResult_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "OperationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperationLog_idempotencyKey_key" ON "OperationLog"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "OperationLog_status_createdAt_idx" ON "OperationLog"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "OperationLog_projectId_createdAt_idx" ON "OperationLog"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "OperationLog_category_createdAt_idx" ON "OperationLog"("category", "createdAt");
CREATE INDEX IF NOT EXISTS "ProviderCallAttempt_operationId_startedAt_idx" ON "ProviderCallAttempt"("operationId", "startedAt");
CREATE INDEX IF NOT EXISTS "ProviderCallAttempt_provider_model_startedAt_idx" ON "ProviderCallAttempt"("provider", "model", "startedAt");
CREATE INDEX IF NOT EXISTS "ProviderCallAttempt_externalTaskId_idx" ON "ProviderCallAttempt"("externalTaskId");
CREATE INDEX IF NOT EXISTS "OperationResult_operationId_createdAt_idx" ON "OperationResult"("operationId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "OperationResult_operationId_assetId_key" ON "OperationResult"("operationId", "assetId");
CREATE UNIQUE INDEX IF NOT EXISTS "OperationResult_operationId_userAssetId_key" ON "OperationResult"("operationId", "userAssetId");
CREATE UNIQUE INDEX IF NOT EXISTS "OperationResult_operationId_videoSegmentId_key" ON "OperationResult"("operationId", "videoSegmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "OperationResult_operationId_voiceoverSegmentId_key" ON "OperationResult"("operationId", "voiceoverSegmentId");
