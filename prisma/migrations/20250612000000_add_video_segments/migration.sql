-- 工作指令.txt Phase 2：宣传片/直出视频分片重构所需的数据库变更
-- VideoSegment 表已在 schema.prisma 中定义，本迁移与 Prisma Schema 保持一致

-- 创建视频片段表
CREATE TABLE IF NOT EXISTS "VideoSegment" (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  shot_id TEXT NOT NULL,
  step_name TEXT NOT NULL, -- 'TRAILER' | 'VIDEO_DIRECT' | 'VIDEO_RENDER'
  prompt TEXT NOT NULL,
  caption TEXT,
  video_url TEXT,
  storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | generating | completed | failed
  sequence INTEGER NOT NULL,
  duration INTEGER,
  is_mock BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "VideoSegment_project_id_status_idx" ON "VideoSegment"("project_id", "status");
CREATE INDEX IF NOT EXISTS "VideoSegment_project_id_step_name_idx" ON "VideoSegment"("project_id", "step_name");
CREATE INDEX IF NOT EXISTS "VideoSegment_project_id_sequence_idx" ON "VideoSegment"("project_id", "sequence");

-- 扩展项目表：合成视频与 BGM
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS combined_video_url TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS combined_video_status TEXT DEFAULT 'pending';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS bgm_url TEXT;
