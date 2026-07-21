// ============================================================
// 工作流状态机引擎 — 条件解锁非线性 DAG
// ============================================================

import { prisma } from './prisma'

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
  stepStoryboardDone: boolean
  stepStoryboardFirstframeDone: boolean
  stepTrailerDone: boolean
  stepEndingDone: boolean
  stepDirectDone: boolean
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
    hideCondition: (p) => p.stepConceptDone,
  },
  storyboard: {
    unlockCondition: (p) => p.stepFrameworkDone,
    hideCondition: (p) => p.stepEndingDone || p.stepDirectDone,
  },
  trailer: {
    unlockCondition: (p) => p.stepFrameworkDone,
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
  steps: Array<{ stepType: string; status: string }>
): ProjectState {
  const isDone = (type: string) =>
    steps.some((s) => s.stepType === type && s.status === 'COMPLETED')

  return {
    stepIdeaDone: isDone('IDEATION'),
    stepFrameworkDone: isDone('FRAMEWORK'),
    stepStyleDone: isDone('STYLE'),
    stepCharacterDone: isDone('CHARACTER'),
    stepConceptDone: isDone('CONCEPT'),
    stepStoryboardDone: isDone('STORYBOARD'),
    stepStoryboardFirstframeDone: isDone('STORYBOARD'), // TODO: 区分普通完成 vs 首帧完成
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
 * 获取项目默认长宽比。
 * 优先从 STYLE 步骤 outputData.selectedAspectRatio / aspectRatio 读取，
 * 用于让后续生图步骤默认沿用用户在风格图步骤选择的 ratio。
 */
export async function getProjectDefaultAspectRatio(projectId: string): Promise<string> {
  try {
    const styleStep = await prisma.workflowStep.findFirst({
      where: { projectId, stepType: 'STYLE' },
      select: { outputData: true },
    })
    const output = (styleStep?.outputData as any) || {}
    return output?.selectedAspectRatio || output?.aspectRatio || '16:9'
  } catch {
    return '16:9'
  }
}

/**
 * 根据 Prisma stepType 获取 StepId（可能返回 undefined，因为不是所有 12 步都在 DAG 中）
 */
export function prismaTypeToStepId(stepType: string): StepId | undefined {
  return TYPE_TO_STEP_ID[stepType]
}
