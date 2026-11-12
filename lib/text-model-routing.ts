export const TEXT_ROUTING_MODES = ['economy', 'balanced', 'quality', 'custom'] as const
export type TextRoutingMode = typeof TEXT_ROUTING_MODES[number]

export const CREATIVE_TEXT_STAGE_IDS = [
  'goal-contract',
  'strategy-map',
  'concept-narrative-emotion',
  'concept-audience-experience',
  'concept-audiovisual-production',
  'critique',
  'creative-plan',
] as const
export type CreativeTextStageId = typeof CREATIVE_TEXT_STAGE_IDS[number]

export interface CreativeTextRouteStage {
  id: CreativeTextStageId
  label: string
  model: string
}

export interface CreativeTextRoutingSnapshot {
  mode: Exclude<TextRoutingMode, 'custom'>
  label: string
  description: string
  catalogCheckedAt: string
  priceSnapshotDate: string
  searchModel: 'gpt-5-search-api'
  searchCalls: 3
  stages: CreativeTextRouteStage[]
  estimatedCostUsd: { min: number; max: number }
}

export interface CreativeTextRoutingProfilePreview {
  mode: Exclude<TextRoutingMode, 'custom'>
  label: string
  description: string
  searchCalls: 3
  stages: CreativeTextRouteStage[]
  estimatedCostUsd: { min: number; max: number }
  priceSnapshotDate: string
}

const LABELS: Record<CreativeTextStageId, string> = {
  'goal-contract': '理解目标',
  'strategy-map': '形成策略',
  'concept-narrative-emotion': '创意 · 叙事与情绪',
  'concept-audience-experience': '创意 · 受众体验',
  'concept-audiovisual-production': '创意 · 视听与制作',
  critique: '交叉评审',
  'creative-plan': '归纳方案',
}

const PROFILE_META: Record<Exclude<TextRoutingMode, 'custom'>, { label: string; description: string }> = {
  economy: { label: '省钱', description: '保留十个固定 Agent 调用，使用低成本模型完成规则化任务和日常创作。' },
  balanced: { label: '平衡（推荐）', description: '三路创意使用不同模型，强模型只承担一次关键评审。' },
  quality: { label: '高质量', description: '策略、三路创意、评审与归纳均优先使用高能力异构模型。' },
}

type CandidateTable = Record<CreativeTextStageId, readonly string[]>

const ROUTES: Record<Exclude<TextRoutingMode, 'custom'>, CandidateTable> = {
  economy: {
    'goal-contract': ['gpt-6-luna', 'claude-haiku-5-5', 'qwen3.8-flash', 'deepseek-v4.1-flash'],
    'strategy-map': ['gpt-6.1-sol', 'deepseek-v4.1-flash', 'deepseek-v3-1'],
    'concept-narrative-emotion': ['gpt-6.1-sol', 'deepseek-v4.1-flash', 'deepseek-v3-1'],
    'concept-audience-experience': ['glm-5.3-flash', 'gpt-6-luna', 'qwen3.8-flash', 'deepseek-v4.1-flash'],
    'concept-audiovisual-production': ['gpt-6.1-sol', 'deepseek-v4.1-flash', 'deepseek-v3-1'],
    critique: ['gpt-6.1-sol', 'deepseek-v4-pro', 'deepseek-v3-1'],
    'creative-plan': ['gpt-6.1-sol', 'deepseek-v4-pro', 'deepseek-v3-1'],
  },
  balanced: {
    'goal-contract': ['gpt-6-luna', 'claude-haiku-5-5', 'qwen3.8-flash', 'deepseek-v4.1-flash'],
    'strategy-map': ['gpt-6.1-sol', 'claude-sonnet-5-5', 'deepseek-v4-pro'],
    'concept-narrative-emotion': ['claude-fable-5-1', 'claude-fable-5', 'claude-sonnet-5-5'],
    'concept-audience-experience': ['kimi-k3.1-pro', 'kimi-k3', 'claude-sonnet-5-5'],
    'concept-audiovisual-production': ['gpt-6.1-sol', 'claude-sonnet-5-5', 'deepseek-v4-pro'],
    critique: ['gpt-6-astra', 'claude-opus-5-5', 'gpt-6.1-sol'],
    'creative-plan': ['gpt-6.1-sol', 'claude-sonnet-5-5', 'deepseek-v4-pro'],
  },
  quality: {
    'goal-contract': ['gpt-6.1-sol', 'claude-sonnet-5-5', 'deepseek-v4-pro'],
    'strategy-map': ['gpt-6-astra', 'claude-opus-5-5', 'gpt-6.1-sol'],
    'concept-narrative-emotion': ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5'],
    'concept-audience-experience': ['kimi-k3.1-pro', 'claude-sonnet-5-5', 'gpt-6.1-sol'],
    'concept-audiovisual-production': ['claude-sonnet-5-5', 'gpt-6.1-sol', 'deepseek-v4-pro'],
    critique: ['gpt-6-astra', 'claude-opus-5-5', 'gpt-6.1-sol'],
    'creative-plan': ['claude-opus-5-5', 'gpt-6-astra', 'gpt-6.1-sol'],
  },
}

// OpenLux public pricing snapshot, USD per one million input/output tokens.
// It is deliberately dated and shown as an estimate; billing reconciliation must use provider usage.
export const TEXT_PRICE_SNAPSHOT_DATE = '2026-10-30'
const PRICE_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  'gpt-6-luna': { input: 0.0059, output: 0.0294 },
  'gpt-6.1-sol': { input: 0.0735, output: 0.3677 },
  'gpt-6-astra': { input: 0.3677, output: 1.838 },
  'claude-haiku-5-5': { input: 0.0088, output: 0.0441 },
  'claude-sonnet-5-5': { input: 0.1765, output: 0.8824 },
  'claude-opus-5-5': { input: 0.353, output: 1.765 },
  'claude-fable-5': { input: 1.765, output: 8.823 },
  'claude-fable-5-1': { input: 1.765, output: 8.823 },
  'kimi-k3': { input: 0.9, output: 4.5 },
  'kimi-k3.1-pro': { input: 0.6, output: 3 },
  'glm-5.3-flash': { input: 0.045, output: 0.15 },
  'qwen3.8-flash': { input: 0.15, output: 0.47 },
  'deepseek-v3-1': { input: 0.1739, output: 0.5218 },
  'deepseek-v4.1-flash': { input: 0.09, output: 0.36 },
  'deepseek-v4-pro': { input: 0.396, output: 1.188 },
  'gpt-5-search-api': { input: 0.7353, output: 5.882 },
}

const TOKEN_RANGES: Record<CreativeTextStageId | 'research', { input: [number, number]; output: [number, number] }> = {
  'goal-contract': { input: [1500, 4000], output: [600, 1500] },
  research: { input: [1500, 4000], output: [1500, 4000] },
  'strategy-map': { input: [8000, 16000], output: [1000, 3000] },
  'concept-narrative-emotion': { input: [7000, 13000], output: [1000, 2500] },
  'concept-audience-experience': { input: [7000, 13000], output: [1000, 2500] },
  'concept-audiovisual-production': { input: [7000, 13000], output: [1000, 2500] },
  critique: { input: [8000, 14000], output: [1000, 3000] },
  'creative-plan': { input: [10000, 16000], output: [1500, 4000] },
}

function chooseAvailable(candidates: readonly string[], available: Set<string>): string | null {
  return candidates.find((model) => available.has(model)) || null
}

function estimateCall(model: string, range: { input: [number, number]; output: [number, number] }) {
  const price = PRICE_PER_MILLION_USD[model]
  if (!price) return null
  return {
    min: (range.input[0] * price.input + range.output[0] * price.output) / 1_000_000,
    max: (range.input[1] * price.input + range.output[1] * price.output) / 1_000_000,
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export function normalizeTextRoutingMode(value: unknown): TextRoutingMode {
  return TEXT_ROUTING_MODES.includes(value as TextRoutingMode) ? value as TextRoutingMode : 'balanced'
}

export function buildCreativeTextRoutingSnapshot(
  mode: Exclude<TextRoutingMode, 'custom'>,
  availableModelIds: string[],
  now = new Date(),
): CreativeTextRoutingSnapshot {
  const available = new Set(availableModelIds)
  const stages = CREATIVE_TEXT_STAGE_IDS.map((id) => {
    const model = chooseAvailable(ROUTES[mode][id], available)
    if (!model) throw new Error(`TEXT_ROUTING_MODEL_UNAVAILABLE:${mode}:${id}`)
    return { id, label: LABELS[id], model }
  })
  let min = 0
  let max = 0
  for (const stage of stages) {
    const cost = estimateCall(stage.model, TOKEN_RANGES[stage.id])
    if (!cost) throw new Error(`TEXT_ROUTING_PRICE_UNAVAILABLE:${stage.model}`)
    min += cost.min
    max += cost.max
  }
  const search = estimateCall('gpt-5-search-api', TOKEN_RANGES.research)
  if (!search) throw new Error('TEXT_ROUTING_PRICE_UNAVAILABLE:gpt-5-search-api')
  min += search.min * 3
  max += search.max * 3
  return {
    mode,
    ...PROFILE_META[mode],
    catalogCheckedAt: now.toISOString(),
    priceSnapshotDate: TEXT_PRICE_SNAPSHOT_DATE,
    searchModel: 'gpt-5-search-api',
    searchCalls: 3,
    stages,
    estimatedCostUsd: { min: roundUsd(min), max: roundUsd(max) },
  }
}

export function buildCreativeTextRoutingPreviews(availableModelIds: string[]): CreativeTextRoutingProfilePreview[] {
  return (['economy', 'balanced', 'quality'] as const).flatMap((mode) => {
    try {
      const snapshot = buildCreativeTextRoutingSnapshot(mode, availableModelIds)
      return [{
        mode,
        label: snapshot.label,
        description: snapshot.description,
        searchCalls: snapshot.searchCalls,
        stages: snapshot.stages,
        estimatedCostUsd: snapshot.estimatedCostUsd,
        priceSnapshotDate: snapshot.priceSnapshotDate,
      }]
    } catch {
      return []
    }
  })
}

export function modelForCreativeStage(
  snapshot: CreativeTextRoutingSnapshot | null | undefined,
  stageId: string | undefined,
  legacyModel: string,
): string {
  if (!snapshot || !stageId) return legacyModel
  return snapshot.stages.find((stage) => stage.id === stageId)?.model || legacyModel
}
