// Phase 3B/6: 视频 API 工厂接口定义
// 真实实现将在 Phase 6 中填充（可灵 / Runway / Pika）

/**
 * 工作指令.txt（Round 7/8）：宣传片生成结果。
 * - segments: 6 个 5s 片段元信息（含 videoUrl + isMock 标记）
 * - musicUrl: 30s 背景音乐 URL（Round 8 起 Suno 真实生成，失败回退静音）
 * - musicIsMock: true=lavfi 静音占位; false=Suno 真实音乐
 */
export interface TrailerSegment {
  index: number
  videoUrl: string         // 单段 5s 视频签名 URL
  prompt?: string          // 视频生成提示词
  cameraMotion?: string    // 镜头运动描述
  isMock: boolean          // true=Ken Burns 兜底,false=Jimeng/Hailuo 真实生成
  durationSec: number
}

export interface TrailerResult {
  url: string              // 30s 完整宣传片签名 URL
  duration: number         // 总时长（秒）
  storageKey: string       // R2 存储 key
  segments?: TrailerSegment[]
  musicUrl?: string | null
  musicIsMock?: boolean    // Round 8 新增：Suno 失败回退静音时为 true
}

export interface VideoClient {
  generateTrailer(conceptImageKeys: string[], projectId: string): Promise<TrailerResult>;
  generateDirectVideo(firstFrameKey: string, lastFrameKey: string | null, shotId: string, projectId: string, model?: string): Promise<{ url: string; duration: number; storageKey: string }>;
  query(taskId: string): Promise<{ status: 'completed' | 'failed'; url?: string }>;
}

export const realVideoClient: VideoClient = {
  generateTrailer: async () => {
    throw new Error('Real video client not implemented (Phase 6)');
  },
  generateDirectVideo: async () => {
    throw new Error('Real video client not implemented (Phase 6)');
  },
  query: async () => {
    throw new Error('Real video client not implemented (Phase 6)');
  },
};
