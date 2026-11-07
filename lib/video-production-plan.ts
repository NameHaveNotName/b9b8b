import {
  estimateVideoCost,
  getVideoModelConfig,
  resolveDurationForModel,
  resolveVideoModelForShot,
  type VideoTier,
} from './models-config.ts'

export interface CreativeShotPlan {
  shotId: string
  actNumber?: number | null
  sequence: number
  durationMs: number
  tier: VideoTier
  prompt?: string
  groupKey?: string | null
  groupingSource?: 'explicit-unit' | 'explicit-action-chain' | 'scene-fallback' | 'isolated' | 'trailer'
}

export interface PlannedGenerationUnit {
  strategy: 'SINGLE_SHOT' | 'MULTI_SHOT'
  shots: CreativeShotPlan[]
  requestedDurationMs: number
}

export interface StrategyCostInput {
  shots: Array<Pick<CreativeShotPlan, 'durationMs'>>
  independentModelId: string
  multiShotModelId: string
  independentSuccessRate?: number
  multiShotSuccessRate?: number
  independentUsableFraction?: number
  multiShotUsableFraction?: number
}

export interface StrategyCostEstimate {
  strategy: 'INDEPENDENT_SHOTS' | 'MULTI_SHOT_UNIT'
  nominalCostUsd: number
  expectedUsableCostUsd: number
  requestedSeconds: number
  billableSeconds: number
  wastedSeconds: number
  successRate: number
  usableFraction: number
}

function boundedProbability(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0.01, Math.min(1, value as number))
}

/**
 * Packs adjacent creative shots into generation units without crossing group boundaries.
 * It only describes production intent; provider duration adaptation happens separately.
 */
export function packShotsIntoGenerationUnits(
  shots: CreativeShotPlan[],
  options: { maxUnitDurationMs: number; providerHardShotLimit?: number }
): PlannedGenerationUnit[] {
  const ordered = [...shots].sort((a, b) => a.sequence - b.sequence)
  const units: PlannedGenerationUnit[] = []
  let current: CreativeShotPlan[] = []
  let currentDuration = 0

  const flush = () => {
    if (!current.length) return
    units.push({
      strategy: current.length > 1 ? 'MULTI_SHOT' : 'SINGLE_SHOT',
      shots: current,
      requestedDurationMs: currentDuration,
    })
    current = []
    currentDuration = 0
  }

  for (const shot of ordered) {
    const previous = current[current.length - 1]
    const crossesGroup = previous && (previous.groupKey || null) !== (shot.groupKey || null)
    const exceedsDuration = currentDuration + shot.durationMs > options.maxUnitDurationMs
    const exceedsCount = options.providerHardShotLimit != null
      && current.length >= options.providerHardShotLimit
    if (current.length && (crossesGroup || exceedsDuration || exceedsCount)) flush()
    current.push(shot)
    currentDuration += shot.durationMs
  }
  flush()
  return units
}

function expectedUsableCost(nominal: number, successRate: number, usableFraction: number): number {
  return Math.round((nominal / (successRate * usableFraction)) * 1_000_000) / 1_000_000
}

function normalizedCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Average creative-shot duration below which bundling short shots is cheaper
 * than paying the independent model's minimum duration for every shot.
 */
export function calculateBundlingBreakEvenAverageShotSeconds(args: {
  independentMinimumSeconds: number
  independentCostPerSecond: number
  bundledCostPerSecond: number
  independentExpectedAttempts?: number
  bundledExpectedAttempts?: number
}): number {
  const values = [
    args.independentMinimumSeconds,
    args.independentCostPerSecond,
    args.bundledCostPerSecond,
    args.independentExpectedAttempts ?? 1,
    args.bundledExpectedAttempts ?? 1,
  ]
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Break-even inputs must be finite positive numbers')
  }
  return normalizedCost(
    (args.independentMinimumSeconds
      * args.independentCostPerSecond
      * (args.independentExpectedAttempts ?? 1))
    / (args.bundledCostPerSecond * (args.bundledExpectedAttempts ?? 1))
  )
}

/**
 * Compares actual provider billing units, not merely advertised dollars per second.
 * Expected usable cost incorporates retries and the fraction of generated footage retained.
 */
export function compareGenerationStrategyCosts(input: StrategyCostInput): {
  independent: StrategyCostEstimate
  multiShot: StrategyCostEstimate
  recommended: StrategyCostEstimate['strategy']
  savingsUsd: number
} {
  const requestedSeconds = input.shots.reduce((sum, shot) => sum + Math.max(0, shot.durationMs) / 1000, 0)

  const independentBillable = input.shots.reduce(
    (sum, shot) => sum + resolveDurationForModel(input.independentModelId, shot.durationMs / 1000),
    0
  )
  const independentNominal = input.shots.reduce(
    (sum, shot) => sum + estimateVideoCost(input.independentModelId, shot.durationMs / 1000),
    0
  )
  const multiShotBillable = resolveDurationForModel(input.multiShotModelId, requestedSeconds)
  const multiShotNominal = estimateVideoCost(input.multiShotModelId, requestedSeconds)

  const independentSuccessRate = boundedProbability(input.independentSuccessRate, 0.85)
  const multiShotSuccessRate = boundedProbability(input.multiShotSuccessRate, 0.75)
  const independentUsableFraction = boundedProbability(input.independentUsableFraction, 0.9)
  const multiShotUsableFraction = boundedProbability(input.multiShotUsableFraction, 0.7)

  const independent: StrategyCostEstimate = {
    strategy: 'INDEPENDENT_SHOTS',
    nominalCostUsd: normalizedCost(independentNominal),
    expectedUsableCostUsd: expectedUsableCost(independentNominal, independentSuccessRate, independentUsableFraction),
    requestedSeconds,
    billableSeconds: independentBillable,
    wastedSeconds: Math.max(0, independentBillable - requestedSeconds),
    successRate: independentSuccessRate,
    usableFraction: independentUsableFraction,
  }
  const multiShot: StrategyCostEstimate = {
    strategy: 'MULTI_SHOT_UNIT',
    nominalCostUsd: normalizedCost(multiShotNominal),
    expectedUsableCostUsd: expectedUsableCost(multiShotNominal, multiShotSuccessRate, multiShotUsableFraction),
    requestedSeconds,
    billableSeconds: multiShotBillable,
    wastedSeconds: Math.max(0, multiShotBillable - requestedSeconds),
    successRate: multiShotSuccessRate,
    usableFraction: multiShotUsableFraction,
  }
  const recommended = independent.expectedUsableCostUsd <= multiShot.expectedUsableCostUsd
    ? independent.strategy
    : multiShot.strategy
  return {
    independent,
    multiShot,
    recommended,
    savingsUsd: Math.abs(independent.expectedUsableCostUsd - multiShot.expectedUsableCostUsd),
  }
}

export interface GenerationUnitTimelineEntry {
  sequence: number
  internalShotIds: string[]
  sourceStartMs: number
  sourceEndMs: number
  timelineStartMs: number
  timelineEndMs: number
  durationMs: number
}

export interface GenerationStrategyUnitPreview {
  strategy: 'SINGLE_SHOT' | 'MULTI_SHOT'
  modelId: string
  shotIds: string[]
  requestedSeconds: number
  billableSeconds: number
  nominalCostUsd: number
  referenceAssetCount: number
  adapterReferenceAssetLimit: number
  providerReferenceImageLimit: number
  referenceCapacityExceeded: boolean
}

export interface GenerationStrategyOptionPreview {
  strategy: 'INDEPENDENT_SHOTS' | 'MULTI_SHOT_UNITS'
  units: GenerationStrategyUnitPreview[]
  requestedSeconds: number
  billableSeconds: number
  wastedSeconds: number
  nominalCostUsd: number
  expectedUsableCostUsd: number
  successRate: number
  usableFraction: number
  executionReady: boolean
  warnings: string[]
}

export interface GenerationStrategyPreview {
  independent: GenerationStrategyOptionPreview
  multiShot: GenerationStrategyOptionPreview
  economicRecommendation: GenerationStrategyOptionPreview['strategy']
  executableRecommendation: GenerationStrategyOptionPreview['strategy']
  expectedSavingsUsd: number
}

export interface IndependentFallbackUnit {
  strategy: 'SINGLE_SHOT'
  replacesFailedUnitId: string
  shot: CreativeShotPlan
  modelId: string
  requestedDurationMs: number
  billableDurationMs: number
  estimatedCostUsd: number
}

/** Convert a failed multi-shot unit into independently retryable requests. */
export function buildIndependentFallbackPlan(args: {
  failedUnitId: string
  shots: CreativeShotPlan[]
  modelOverride?: string | null
}): IndependentFallbackUnit[] {
  if (!args.failedUnitId) throw new Error('Fallback plan requires failedUnitId')
  if (args.shots.length < 2) throw new Error('Fallback plan requires a multi-shot unit')
  return [...args.shots].sort((a, b) => a.sequence - b.sequence).map((shot) => {
    const modelId = resolveVideoModelForShot(shot, args.modelOverride)
    const requestedSeconds = shot.durationMs / 1000
    const billableSeconds = resolveDurationForModel(modelId, requestedSeconds)
    return {
      strategy: 'SINGLE_SHOT',
      replacesFailedUnitId: args.failedUnitId,
      shot,
      modelId,
      requestedDurationMs: shot.durationMs,
      billableDurationMs: billableSeconds * 1000,
      estimatedCostUsd: normalizedCost(estimateVideoCost(modelId, requestedSeconds)),
    }
  })
}

function summarizeOption(args: {
  strategy: GenerationStrategyOptionPreview['strategy']
  units: GenerationStrategyUnitPreview[]
  successRate: number
  usableFraction: number
  executionReady: boolean
  warnings?: string[]
}): GenerationStrategyOptionPreview {
  const requestedSeconds = args.units.reduce((sum, unit) => sum + unit.requestedSeconds, 0)
  const billableSeconds = args.units.reduce((sum, unit) => sum + unit.billableSeconds, 0)
  const nominalCostUsd = normalizedCost(args.units.reduce((sum, unit) => sum + unit.nominalCostUsd, 0))
  return {
    strategy: args.strategy,
    units: args.units,
    requestedSeconds,
    billableSeconds,
    wastedSeconds: Math.max(0, billableSeconds - requestedSeconds),
    nominalCostUsd,
    expectedUsableCostUsd: expectedUsableCost(nominalCostUsd, args.successRate, args.usableFraction),
    successRate: args.successRate,
    usableFraction: args.usableFraction,
    executionReady: args.executionReady,
    warnings: args.warnings || [],
  }
}

/**
 * Builds a read-only production strategy preview. It never submits provider tasks.
 * Multi-shot execution deliberately remains gated until the provider's multi-reference
 * request roles and long-prompt contract are verified end to end.
 */
export function buildGenerationStrategyPreview(args: {
  shots: CreativeShotPlan[]
  independentModelOverride?: string | null
  multiShotModelId: string
  maxUnitDurationMs: number
  providerHardShotLimit?: number
  independentSuccessRate?: number
  multiShotSuccessRate?: number
  independentUsableFraction?: number
  multiShotUsableFraction?: number
  multiShotExecutionEnabled?: boolean
}): GenerationStrategyPreview {
  const shots = [...args.shots].sort((a, b) => a.sequence - b.sequence)
  const independentUnits: GenerationStrategyUnitPreview[] = shots.map((shot) => {
    const modelId = resolveVideoModelForShot(shot, args.independentModelOverride)
    const cfg = getVideoModelConfig(modelId)
    const requestedSeconds = shot.durationMs / 1000
    return {
      strategy: 'SINGLE_SHOT',
      modelId,
      shotIds: [shot.shotId],
      requestedSeconds,
      billableSeconds: resolveDurationForModel(modelId, requestedSeconds),
      nominalCostUsd: normalizedCost(estimateVideoCost(modelId, requestedSeconds)),
      referenceAssetCount: 1,
      adapterReferenceAssetLimit: cfg?.referenceAssetLimit || 0,
      providerReferenceImageLimit: cfg?.providerReferenceImageLimit || cfg?.referenceAssetLimit || 0,
      referenceCapacityExceeded: !cfg?.supportsReferenceAssets || (cfg.referenceAssetLimit || 0) < 1,
    }
  })

  const packed = packShotsIntoGenerationUnits(shots, {
    maxUnitDurationMs: args.maxUnitDurationMs,
    providerHardShotLimit: args.providerHardShotLimit,
  })
  const multiCfg = getVideoModelConfig(args.multiShotModelId)
  const multiUnits: GenerationStrategyUnitPreview[] = packed.map((unit) => {
    const requestedSeconds = unit.requestedDurationMs / 1000
    const referenceAssetCount = unit.shots.length
    const adapterReferenceAssetLimit = multiCfg?.referenceAssetLimit || 0
    return {
      strategy: unit.strategy,
      modelId: args.multiShotModelId,
      shotIds: unit.shots.map((shot) => shot.shotId),
      requestedSeconds,
      billableSeconds: resolveDurationForModel(args.multiShotModelId, requestedSeconds),
      nominalCostUsd: normalizedCost(estimateVideoCost(args.multiShotModelId, requestedSeconds)),
      referenceAssetCount,
      adapterReferenceAssetLimit,
      providerReferenceImageLimit: multiCfg?.providerReferenceImageLimit || adapterReferenceAssetLimit,
      referenceCapacityExceeded: !multiCfg?.supportsReferenceAssets
        || referenceAssetCount > adapterReferenceAssetLimit,
    }
  })

  const independentWarnings = independentUnits.some((unit) => unit.referenceCapacityExceeded)
    ? ['部分独立生成模型不支持当前首帧参考输入。']
    : []
  const multiWarnings: string[] = []
  if (!multiCfg) multiWarnings.push('多镜头模型不在已验证配置中。')
  if (multiUnits.some((unit) => unit.referenceCapacityExceeded)) {
    multiWarnings.push('部分长生成单元的参考图数量超过当前已验证协议上限。')
  }
  if (!args.multiShotExecutionEnabled) {
    multiWarnings.push('多镜头长生成协议仍处于预览阶段，当前不会提交供应商任务。')
  }

  const independent = summarizeOption({
    strategy: 'INDEPENDENT_SHOTS',
    units: independentUnits,
    successRate: boundedProbability(args.independentSuccessRate, 0.85),
    usableFraction: boundedProbability(args.independentUsableFraction, 0.9),
    executionReady: independentWarnings.length === 0,
    warnings: independentWarnings,
  })
  const multiShot = summarizeOption({
    strategy: 'MULTI_SHOT_UNITS',
    units: multiUnits,
    successRate: boundedProbability(args.multiShotSuccessRate, 0.75),
    usableFraction: boundedProbability(args.multiShotUsableFraction, 0.7),
    executionReady: Boolean(args.multiShotExecutionEnabled)
      && Boolean(multiCfg)
      && !multiUnits.some((unit) => unit.referenceCapacityExceeded),
    warnings: multiWarnings,
  })
  const economicRecommendation = independent.expectedUsableCostUsd <= multiShot.expectedUsableCostUsd
    ? independent.strategy
    : multiShot.strategy
  const executableRecommendation = economicRecommendation === multiShot.strategy && !multiShot.executionReady
    ? independent.strategy
    : economicRecommendation
  return {
    independent,
    multiShot,
    economicRecommendation,
    executableRecommendation,
    expectedSavingsUsd: normalizedCost(Math.abs(
      independent.expectedUsableCostUsd - multiShot.expectedUsableCostUsd
    )),
  }
}

/**
 * Builds the final timeline at generation-unit granularity. Internal shots are
 * prompt structure only: one provider task, one returned clip, one timeline row.
 */
export function buildGenerationUnitTimeline(
  units: PlannedGenerationUnit[]
): GenerationUnitTimelineEntry[] {
  let timelineCursor = 0
  return units.map((unit, sequence) => {
    if (!Number.isInteger(unit.requestedDurationMs) || unit.requestedDurationMs <= 0) {
      throw new Error(`Invalid generation unit duration at ${sequence}: ${unit.requestedDurationMs}`)
    }
    if (!unit.shots.length) {
      throw new Error(`Generation unit ${sequence} has no internal shots`)
    }
    const entry: GenerationUnitTimelineEntry = {
      sequence,
      internalShotIds: unit.shots.map((shot) => shot.shotId),
      sourceStartMs: 0,
      sourceEndMs: unit.requestedDurationMs,
      timelineStartMs: timelineCursor,
      timelineEndMs: timelineCursor + unit.requestedDurationMs,
      durationMs: unit.requestedDurationMs,
    }
    timelineCursor = entry.timelineEndMs
    return entry
  })
}
