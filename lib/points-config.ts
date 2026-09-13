// 纯常量文件，环境无关（可被客户端和服务端同时引用）

/**
 * 点数与人民币换算基准：
 * 1 点数 = 0.01 元（1 分人民币）
 * 因此：
 *   - 0.01 元 = 1 点
 *   - 0.1 元 = 10 点
 *   - 1 元 = 100 点
 *   - 1.5 元 = 150 点
 * 该换算需与 OpenLux 控制台中的实际花费定期校准。
 */
export const POINTS_PER_YUAN = 100

/** 各工作流步骤/生成按钮的点数开销（基于实际 API 调用成本） */
export const GENERATION_COSTS = {
  // 文本类（DeepSeek chat 等，单次约 0.001 ~ 0.02 元）
  IDEA_DIFFUSION: 1,        // 创意发散
  FRAMEWORK: 1,             // 框架搭建
  FRAMEWORK_DEEPEN_ALL: 3,  // 框架自动深化全套（角色+故事+环境）
  STYLE_UNIFY: 2,           // 风格统一（含文本 + 可能出图）
  CHARACTER_DESIGN: 3,      // 角色设计（文本 + 出图）
  CONCEPT_ART: 3,           // 概念图（文本 + 出图）
  STORYBOARD_PROMPTS: 1,    // 分镜：仅生成分镜提示词（文本）
  STORYBOARD_IMAGES: 1,     // 分镜：生成所有占位草图（无 AI 图生成本）
  STORYBOARD_ACT_IMAGE: 3,  // 分镜：按幕/按镜头生成真实首帧（文本 + AI 出图）
  KEYFRAME: 3,              // 关键帧/首帧（文本 + 出图）
  ENDING_FRAME: 3,          // 结尾帧（文本 + 出图）
  TRAILER: 150,             // 预告片（文本 + 视频，约 1.5 元）

  // 直出视频（OpenLux / Vidu 实际成本尚需按账户价格校准）
  VIDEO_DIRECT_SEGMENT: 150, // 暂沿用原每片段点数，避免计费规则无提示变化

  // 配音
  VOICEOVER_SCRIPTS: 1,     // 生成配音文案（DeepSeek）
  VOICEOVER_AUDIO_SEGMENT: 1, // 生成单条配音音频（MiniMax TTS）

  // 背景音乐
  BGM: 10,                  // 生成 BGM（MiniMax/DashScope 音乐）

  // 默认兜底
  DEFAULT: 1,
} as const

/** 保留向后兼容的旧常量名（实际代码应优先使用 GENERATION_COSTS） */
export const DEFAULT_GENERATE_COST = GENERATION_COSTS.DEFAULT
export const DEFAULT_REGENERATE_COST = GENERATION_COSTS.DEFAULT

/**
 * 返回指定图片模型的单张生成点数。
 * OpenLux 尚未提供到账户级价格配置时使用调用方给出的业务步骤成本，
 * 避免在未经确认的情况下改变现有扣费规则。
 */
export function getImageGenerationCost(
  _modelId: string,
  fallback: number = GENERATION_COSTS.DEFAULT,
): number {
  return fallback
}

/** 各工作流步骤的操作成本（与 OperationLog 的 pointsCost 对齐） */
export const STEP_COSTS = {
  idea: GENERATION_COSTS.IDEA_DIFFUSION,
  framework: GENERATION_COSTS.FRAMEWORK,
  style: GENERATION_COSTS.STYLE_UNIFY,
  character: GENERATION_COSTS.CHARACTER_DESIGN,
  concept: GENERATION_COSTS.CONCEPT_ART,
  storyboard: GENERATION_COSTS.STORYBOARD_ACT_IMAGE,
  ending: GENERATION_COSTS.ENDING_FRAME,
  trailer: GENERATION_COSTS.TRAILER,
  direct: GENERATION_COSTS.VIDEO_DIRECT_SEGMENT,
} as const

/** stepName → 成本常量键的映射（供 logOperation 使用） */
export const STEP_COST_MAP: Record<string, keyof typeof STEP_COSTS> = {
  idea_diffusion: 'idea',
  framework: 'framework',
  style_unify: 'style',
  character_design: 'character',
  concept_art: 'concept',
  trailer: 'trailer',
  storyboard: 'storyboard',
  ending_frame: 'ending',
  direct_video: 'direct',
}

/**
 * 计算批量生成的总点数。
 */
export function calculateBatchCost(costPerItem: number, count: number): number {
  return Math.max(0, costPerItem * Math.max(0, count))
}

/** 操作类别映射 */
export type OperationCategory = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'MUSIC' | 'OTHER'

/** 成本常量到操作类别的映射 */
export const COST_CATEGORY_MAP: Record<string, OperationCategory> = {
  IDEA_DIFFUSION: 'TEXT',
  FRAMEWORK: 'TEXT',
  FRAMEWORK_DEEPEN_ALL: 'TEXT',
  STYLE_UNIFY: 'TEXT',
  CHARACTER_DESIGN: 'IMAGE',
  CONCEPT_ART: 'IMAGE',
  STORYBOARD_PROMPTS: 'TEXT',
  STORYBOARD_IMAGES: 'IMAGE',
  STORYBOARD_ACT_IMAGE: 'IMAGE',
  KEYFRAME: 'IMAGE',
  ENDING_FRAME: 'IMAGE',
  TRAILER: 'VIDEO',
  VIDEO_DIRECT_SEGMENT: 'VIDEO',
  VOICEOVER_SCRIPTS: 'TEXT',
  VOICEOVER_AUDIO_SEGMENT: 'AUDIO',
  BGM: 'MUSIC',
  DEFAULT: 'OTHER',
}

/** 成本常量到 actionKey 的映射 */
export const COST_ACTION_KEY_MAP: Record<string, string> = {
  IDEA_DIFFUSION: 'generation.idea_diffusion',
  FRAMEWORK: 'generation.framework',
  FRAMEWORK_DEEPEN_ALL: 'generation.framework_deepen',
  STYLE_UNIFY: 'generation.style_unify',
  CHARACTER_DESIGN: 'generation.character_design',
  CONCEPT_ART: 'generation.concept_art',
  STORYBOARD_PROMPTS: 'generation.storyboard_prompts',
  STORYBOARD_IMAGES: 'generation.storyboard_images',
  STORYBOARD_ACT_IMAGE: 'generation.storyboard_act_image',
  KEYFRAME: 'generation.keyframe',
  ENDING_FRAME: 'generation.ending_frame',
  TRAILER: 'generation.trailer',
  VIDEO_DIRECT_SEGMENT: 'generation.video_direct_segment',
  VOICEOVER_SCRIPTS: 'generation.voiceover_scripts',
  VOICEOVER_AUDIO_SEGMENT: 'generation.voiceover_audio_segment',
  BGM: 'generation.bgm',
  DEFAULT: 'generation.unknown',
}

/**
 * 将人民币金额（元）转换为点数。
 */
export function yuanToPoints(yuan: number): number {
  return Math.round(yuan * POINTS_PER_YUAN)
}
