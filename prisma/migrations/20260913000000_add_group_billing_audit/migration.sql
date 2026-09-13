ALTER TABLE "OperationLog"
ADD COLUMN IF NOT EXISTS "billingSource" TEXT NOT NULL DEFAULT 'USER',
ADD COLUMN IF NOT EXISTS "billingGroupId" TEXT,
ADD COLUMN IF NOT EXISTS "balanceAfter" INTEGER;

CREATE INDEX IF NOT EXISTS "OperationLog_billingGroupId_createdAt_idx"
ON "OperationLog"("billingGroupId", "createdAt");
