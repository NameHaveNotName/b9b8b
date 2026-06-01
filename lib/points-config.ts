// 纯常量文件，环境无关（可被客户端和服务端同时引用）
export const DEFAULT_GENERATE_COST = 0
export const DEFAULT_REGENERATE_COST = 0

/** 各工作流步骤的操作成本（与 OperationLog 的 pointsCost 对齐） */
export const STEP_COSTS = {
  idea: 0,
  framework: 0,
  style: 0,
  character: 0,
  concept: 0,
  trailer: 0,
  storyboard: 0,
  ending: 0,
  direct: 0,
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
