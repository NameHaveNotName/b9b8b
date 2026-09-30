-- WorkflowStep.updatedAt：并发局部更新 outputData 所需的乐观锁 CAS 字段。
--
-- 背景：outputData 是 JSON 列，生成流程普遍是「读快照 → 跑 30~240s 的生成 →
-- 整块写回」。并发生成不同镜头时，后写的那次会用旧快照覆盖前一次的结果，
-- 对方的 firstFrameUrl / shotAssets / generatingShots 条目凭空消失，
-- 卡片永远卡在「生成中」。lib/workflow-executor.mergeStepOutputData 用
-- `UPDATE ... WHERE id = ? AND updated_at = ?` 做 CAS，冲突则重读重算。
--
-- ⚠️ 必须先应用本迁移再上线：mergeStepOutputData / tryMergeStepOutputData
-- 会 select 和 where updated_at，列不存在时相关接口会直接报 500。
-- 应用方式：npx prisma migrate deploy
ALTER TABLE "WorkflowStep"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "WorkflowStep_projectId_updatedAt_idx"
  ON "WorkflowStep"("projectId", "updated_at");
