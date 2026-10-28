// ============================================================
// 工作流状态机引擎 — 条件解锁非线性 DAG
// ============================================================

export type StepId =
  | 'idea'
  | 'framework'
  | 'style'
  | 'character'
  | 'concept'
  | 'storyboard'
  | 'trailer'
  | 'ending'
  | 'direct'

/** StepId → Prisma WorkflowStepType 枚举值 */
export const STEP_ID_TO_TYPE: Record<StepId, string> = {
  idea: 'IDEATION',
  framework: 'FRAMEWORK',
  style: 'STYLE',
  character: 'CHARACTER',
  concept: 'CONCEPT',
  storyboard: 'STORYBOARD',
  trailer: 'TRAILER',
  ending: 'KEYFRAMES',
  direct: 'VIDEO_DIRECT',
}

/** Prisma WorkflowStepType → StepId（仅包含可见步骤） */
export const TYPE_TO_STEP_ID: Record<string, StepId> = {
  IDEATION: 'idea',
  FRAMEWORK: 'framework',
  STYLE: 'style',
  CHARACTER: 'character',
  CONCEPT: 'concept',
  STORYBOARD: 'storyboard',
  TRAILER: 'trailer',
  KEYFRAMES: 'ending',
  VIDEO_DIRECT: 'direct',
}

/** 步骤显示名称 */
export const STEP_LABELS: Record<StepId, string> = {
  idea: '创意扩散',
  framework: '框架搭建',
  style: '风格统一',
  character: '人物设计',
  concept: '概念图',
  storyboard: '分镜设计',
  trailer: '宣传片',
  ending: '生成尾帧',
  direct: '直生视频',
}

/** 步骤顺序（用于进度条排序） */
export const STEP_ORDER: StepId[] = [
  'idea',
  'framework',
  'style',
  'character',
  'concept',
  'trailer',
  'storyboard',
  'ending',
  'direct',
]

/**
 * 项目状态接口（兼容 Prisma Project + 新增的 step_*_done 字段）
 */
export interface ProjectState {
  stepIdeaDone: boolean
  stepFrameworkDone: boolean
  stepStyleDone: boolean
  stepCharacterDone: boolean
  stepConceptDone: boolean
  /** 概念图步骤中是否至少已有一张可用图片（不是“步骤已完成”的同义词） */
  stepConceptImageDone: boolean
  stepStoryboardDone: boolean
  stepStoryboardFirstframeDone: boolean
  stepTrailerDone: boolean
  stepEndingDone: boolean
  stepDirectDone: boolean
}

/**
 * 判断分镜是否已经携带可用于后续生成的画面。
 * 导入、参考图模式、首帧模式和旧数据使用的字段名不同，因此统一兼容。
 */
export function hasStoryboardImage(shots: unknown): boolean {
  if (!Array.isArray(shots)) return false
  return shots.some((shot) => {
    if (!shot || typeof shot !== 'object') return false
    const item = shot as Record<string, unknown>
    return [
      item.firstFrameUrl,
      item.referenceImageUrl,
      item.imageUrl,
      item.thumbnailUrl,
    ].some((value) => typeof value === 'string' && value.trim().length > 0)
  })
}

/**
 * 判断概念图步骤是否已经产出至少一张可供宣传片使用的图片。
 *
 * 新数据通常通过 resultAssets 关联图片；旧数据及逐幕生成结果可能只保存在
 * outputData 中，因此两条路径都要兼容。完成/跳过步骤本身不代表已有图片。
 */
export function hasConceptImage(step: {
  outputData?: unknown
  resultAssets?: Array<{ type?: unknown; url?: unknown; metadata?: unknown }>
} | undefined): boolean {
  if (!step) return false

  const hasAsset = step.resultAssets?.some((asset) => {
    const metadata = asset?.metadata && typeof asset.metadata === 'object'
      ? asset.metadata as Record<string, unknown>
      : null
    return asset?.type === 'IMAGE'
      && metadata?.isMock !== true
      && typeof asset.url === 'string'
      && asset.url.trim().length > 0
  })
  if (hasAsset) return true

  const output = step.outputData
  if (!output || typeof output !== 'object') return false

  const hasImageValue = (value: unknown): boolean => {
    if (typeof value === 'string') return value.trim().length > 0
    if (!value || typeof value !== 'object') return false
    const item = value as Record<string, unknown>
    if (item.isMock === true) return false
    return [item.url, item.imageUrl, item.storageKey].some(
      (candidate) => typeof candidate === 'string' && candidate.trim().length > 0
    )
  }

  const data = output as Record<string, unknown>
  if ([data.url, data.imageUrl, data.storageKey].some(hasImageValue)) return true

  return ['scenes', 'images', 'results'].some((field) => {
    const items = data[field]
    return Array.isArray(items) && items.some(hasImageValue)
  })
}

/** StepId → Project 布尔字段名 */
const STEP_DONE_FIELD: Record<StepId, keyof ProjectState> = {
  idea: 'stepIdeaDone',
  framework: 'stepFrameworkDone',
  style: 'stepStyleDone',
  character: 'stepCharacterDone',
  concept: 'stepConceptDone',
  storyboard: 'stepStoryboardDone',
  trailer: 'stepTrailerDone',
  ending: 'stepEndingDone',
  direct: 'stepDirectDone',
}

interface StepConfig {
  unlockCondition: (p: ProjectState) => boolean
  hideCondition: (p: ProjectState) => boolean
}

export const STEP_CONFIG: Record<StepId, StepConfig> = {
  idea: {
    unlockCondition: () => true,
    hideCondition: (p) => p.stepFrameworkDone,
  },
  framework: {
    unlockCondition: () => true,
    hideCondition: (p) =>
      p.stepStyleDone || p.stepCharacterDone || p.stepConceptDone || p.stepStoryboardDone,
  },
  style: {
    unlockCondition: (p) => p.stepFrameworkDone,
    hideCondition: (p) => p.stepStoryboardDone,
  },
  character: {
    unlockCondition: (p) => p.stepStyleDone,
    hideCondition: (p) => p.stepStoryboardDone,
  },
  concept: {
    unlockCondition: (p) => p.stepCharacterDone,
    // 宣传片完成后，概念图进入只读；概念图自身完成仍可继续补图/重生成。
    hideCondition: (p) => p.stepTrailerDone,
  },
  storyboard: {
    unlockCondition: (p) => p.stepFrameworkDone,
    // 分镜允许持续编辑和重生成，不因下游尾帧/视频完成而进入只读。
    hideCondition: () => false,
  },
  trailer: {
    // 宣传片依赖真实概念图资产，而不是仅依赖概念图步骤完成标记。
    unlockCondition: (p) => p.stepConceptImageDone,
    hideCondition: () => false,
  },
  ending: {
    // 2026-07-16: 只要有至少一个首帧生成，即可进入尾帧/直生视频步骤
    unlockCondition: (p) => p.stepStoryboardFirstframeDone,
    hideCondition: () => false,
  },
  direct: {
    unlockCondition: (p) => p.stepStoryboardFirstframeDone,
    hideCondition: () => false,
  },
}

/**
 * 获取步骤的显示状态
 */
export function getStepDisplayState(stepId: StepId, project: ProjectState) {
  const config = STEP_CONFIG[stepId]
  const isUnlocked = config.unlockCondition(project)
  const isHidden = config.hideCondition(project)
  const isDone = project[STEP_DONE_FIELD[stepId]]

  return {
    isUnlocked,
    isHidden,
    isDone,
    isAvailable: isUnlocked && !isHidden,
  }
}

/**
 * 获取所有步骤的显示状态（用于前端批量渲染）
 */
export function getAllStepDisplayStates(project: ProjectState) {
  const result: Record<StepId, ReturnType<typeof getStepDisplayState>> = {} as any
  for (const stepId of STEP_ORDER) {
    result[stepId] = getStepDisplayState(stepId, project)
  }
  return result
}

/**
 * 检查项目是否已完成某步骤（基于 WorkflowStep status = COMPLETED 的兼容模式）
 * 用于在现有 WorkflowStep 数据之上计算 ProjectState
 */
export function computeProjectStateFromSteps(
  steps: Array<{
    stepType: string
    status: string
    outputData?: unknown
    resultAssets?: Array<{ type?: unknown; url?: unknown; metadata?: unknown }>
  }>
): ProjectState {
  const isDone = (type: string) =>
    steps.some((s) => s.stepType === type && (s.status === 'COMPLETED' || s.status === 'SKIPPED'))
  const storyboardStep = steps.find((step) => step.stepType === 'STORYBOARD')
  const conceptStep = steps.find((step) => step.stepType === 'CONCEPT')
  const storyboardOutput = storyboardStep?.outputData && typeof storyboardStep.outputData === 'object'
    ? storyboardStep.outputData as { shots?: unknown }
    : null
  const hasStoryboardFirstFrame = hasStoryboardImage(storyboardOutput?.shots)

  return {
    stepIdeaDone: isDone('IDEATION'),
    stepFrameworkDone: isDone('FRAMEWORK'),
    stepStyleDone: isDone('STYLE'),
    stepCharacterDone: isDone('CHARACTER'),
    stepConceptDone: isDone('CONCEPT'),
    stepConceptImageDone: hasConceptImage(conceptStep),
    stepStoryboardDone: isDone('STORYBOARD'),
    stepStoryboardFirstframeDone: hasStoryboardFirstFrame,
    stepTrailerDone: isDone('TRAILER'),
    stepEndingDone: isDone('KEYFRAMES'),
    stepDirectDone: isDone('VIDEO_DIRECT'),
  }
}

/**
 * 根据 StepId 获取对应的 Prisma stepType 值
 */
export function stepIdToPrismaType(stepId: StepId): string {
  return STEP_ID_TO_TYPE[stepId]
}

/**
 * 根据 Prisma stepType 获取 StepId
 */
export function prismaTypeToStepId(stepType: string): StepId | undefined {
  return TYPE_TO_STEP_ID[stepType]
}
