export const PRODUCTION_DELIVERY_STAGES = [
  'PRODUCTION_PREPARED',
  'GENERATION_COMPLETE',
  'MATERIALS_ACCEPTED',
  'POST_PRODUCTION',
  'MASTER_ACCEPTED',
  'PLATFORM_DELIVERED',
] as const

export type ProductionDeliveryStage = (typeof PRODUCTION_DELIVERY_STAGES)[number]

export const PRODUCTION_DELIVERY_LABELS: Record<ProductionDeliveryStage, string> = {
  PRODUCTION_PREPARED: '生产准备',
  GENERATION_COMPLETE: '生成完成',
  MATERIALS_ACCEPTED: '素材验收',
  POST_PRODUCTION: '剪辑后期',
  MASTER_ACCEPTED: '母版验收',
  PLATFORM_DELIVERED: '平台交付',
}

export function isProductionDeliveryStage(value: unknown): value is ProductionDeliveryStage {
  return PRODUCTION_DELIVERY_STAGES.includes(value as ProductionDeliveryStage)
}

export function nextProductionDeliveryStage(
  current: ProductionDeliveryStage | null | undefined
): ProductionDeliveryStage | null {
  if (!current) return PRODUCTION_DELIVERY_STAGES[0]
  const index = PRODUCTION_DELIVERY_STAGES.indexOf(current)
  return index >= 0 && index < PRODUCTION_DELIVERY_STAGES.length - 1
    ? PRODUCTION_DELIVERY_STAGES[index + 1]
    : null
}

function text(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export type ManualDeliveryEvidence = {
  evidenceReference: string
  note: string
  platform: string
}

export function normalizeManualDeliveryEvidence(
  stage: ProductionDeliveryStage,
  value: unknown
): ManualDeliveryEvidence {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const evidence = {
    evidenceReference: text(input.evidenceReference, 1000),
    note: text(input.note, 4000),
    platform: text(input.platform, 200),
  }
  if (stage === 'POST_PRODUCTION' || stage === 'MASTER_ACCEPTED') {
    if (evidence.evidenceReference.length < 3) throw new Error('请填写可核对的文件、版本号、哈希或审片链接')
    if (evidence.note.length < 5) throw new Error('请说明本阶段实际完成内容和核验结论')
  }
  if (stage === 'PLATFORM_DELIVERED') {
    if (evidence.platform.length < 2) throw new Error('请填写交付平台')
    if (evidence.evidenceReference.length < 3) throw new Error('请填写发布链接、交付单号或平台记录')
  }
  return evidence
}

export function evaluateSystemProductionGates(input: {
  coverageReady: boolean
  hardGapCount: number
  planExists: boolean
  unitCount: number
  completedUnitCount: number
  playableUnitCount: number
  timelineSegmentCount: number
  acceptedTimelineSegmentCount: number
}) {
  const preparationReasons: string[] = []
  if (!input.coverageReady) preparationReasons.push(`仍有 ${input.hardGapCount} 个A级关键帧缺口`)
  if (!input.planExists || input.unitCount === 0) preparationReasons.push('尚无已激活且包含生成单元的视频生产计划')
  const generationReasons: string[] = []
  if (input.unitCount === 0) generationReasons.push('没有可核对的生成单元')
  if (input.completedUnitCount !== input.unitCount) generationReasons.push(`${input.unitCount - input.completedUnitCount} 个生成单元尚未完成`)
  if (input.playableUnitCount !== input.unitCount) generationReasons.push(`${input.unitCount - input.playableUnitCount} 个生成单元缺少正式可播放素材`)
  const materialReasons: string[] = []
  if (input.timelineSegmentCount === 0) materialReasons.push('成片时间线为空')
  if (input.acceptedTimelineSegmentCount !== input.timelineSegmentCount) {
    materialReasons.push(`${input.timelineSegmentCount - input.acceptedTimelineSegmentCount} 个时间线片段尚未通过人工素材验收`)
  }
  return {
    PRODUCTION_PREPARED: { ready: preparationReasons.length === 0, reasons: preparationReasons },
    GENERATION_COMPLETE: { ready: generationReasons.length === 0, reasons: generationReasons },
    MATERIALS_ACCEPTED: { ready: materialReasons.length === 0, reasons: materialReasons },
  }
}
