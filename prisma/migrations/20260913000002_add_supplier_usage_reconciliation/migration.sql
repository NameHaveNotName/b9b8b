-- Preserve measurable usage independently from money. OpenLux-compatible
-- generation responses expose token usage, but do not consistently expose the
-- account's final charged amount. Actual cost is reconciled separately.
ALTER TABLE "ProviderCallAttempt"
  ADD COLUMN IF NOT EXISTS "inputTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "outputTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "totalTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP(3);

ALTER TABLE "OperationLog"
  ADD COLUMN IF NOT EXISTS "pointsRefunded" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "ProviderCallAttempt_requestId_idx"
  ON "ProviderCallAttempt"("requestId");
