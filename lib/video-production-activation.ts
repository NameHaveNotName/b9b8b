import { getVideoModelConfig } from './models-config.ts'

export type ProductionPlanUnitSnapshot = {
  status: string
  modelId?: string | null
  providerTaskId?: string | null
  referenceAssets?: unknown
}

export type ProductionPlanActivationIssue = {
  code: 'UNIT_NOT_READY' | 'MODEL_NOT_AVAILABLE' | 'REFERENCE_LIMIT_EXCEEDED'
  message: string
}

/** Pure activation gate shared by the API transaction and offline contract tests. */
export function getProductionPlanActivationIssue(
  units: ProductionPlanUnitSnapshot[]
): ProductionPlanActivationIssue | null {
  for (const unit of units) {
    if (!['draft', 'planned'].includes(unit.status) || unit.providerTaskId) {
      return {
        code: 'UNIT_NOT_READY',
        message: '草案中存在已经执行或状态异常的生成单元',
      }
    }
    const model = unit.modelId ? getVideoModelConfig(unit.modelId) : null
    if (!model || model.disabled) {
      return {
        code: 'MODEL_NOT_AVAILABLE',
        message: `生成单元使用的模型不可用：${unit.modelId || '未指定'}`,
      }
    }
    const referenceAssets = unit.referenceAssets as any
    const referenceCount = Array.isArray(referenceAssets?.images) ? referenceAssets.images.length : 0
    if (referenceCount > model.referenceAssetLimit) {
      return {
        code: 'REFERENCE_LIMIT_EXCEEDED',
        message: `${model.label} 当前适配器最多支持 ${model.referenceAssetLimit} 张参考图，草案包含 ${referenceCount} 张`,
      }
    }
  }
  return null
}
