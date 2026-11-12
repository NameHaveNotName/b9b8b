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

export const FRAMEWORK_TEXT_STAGE_IDS = [
  'framework-base',
  'framework-character',
  'framework-synopsis',
  'framework-act',
  'framework-environment-extract',
  'framework-environment-deepen',
] as const
export type FrameworkTextStageId = typeof FRAMEWORK_TEXT_STAGE_IDS[number]

export interface FrameworkTextRouteStage {
  id: FrameworkTextStageId
  label: string
  model: string
}

export interface FrameworkTextRoutingSnapshot {
  mode: Exclude<TextRoutingMode, 'custom'>
  label: string
  description: string
  catalogCheckedAt: string
  priceSnapshotDate: string
  stages: FrameworkTextRouteStage[]
  workloadAssumption: { characters: 2; acts: 3; environments: 2; totalCalls: 10 }
  estimatedCostUsd: { min: number; max: number }
}

export interface FrameworkTextRoutingProfilePreview {
  mode: Exclude<TextRoutingMode, 'custom'>
  label: string
  description: string
  stages: FrameworkTextRouteStage[]
  workloadLabel: string
  estimatedCostUsd: { min: number; max: number }
  priceSnapshotDate: string
}

export const VISUAL_TEXT_STAGE_IDS = ['style-prompt', 'character-prompt', 'concept-prompt'] as const
export type VisualTextStageId = typeof VISUAL_TEXT_STAGE_IDS[number]

export interface VisualTextRoutingSnapshot {
  mode: Exclude<TextRoutingMode, 'custom'>
  label: string
  description: string
  catalogCheckedAt: string
  priceSnapshotDate: string
  stages: Array<{ id: VisualTextStageId; label: string; model: string }>
  estimatedCostUsd: { min: number; max: number }
}

export interface VisualTextRoutingProfilePreview extends Omit<VisualTextRoutingSnapshot, 'catalogCheckedAt'> {
  workloadLabel: string
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

const FRAMEWORK_LABELS: Record<FrameworkTextStageId, string> = {
  'framework-base': '基础故事框架',
  'framework-character': '角色深化',
  'framework-synopsis': '故事梗概深化',
  'framework-act': '逐幕深化',
  'framework-environment-extract': '识别主要环境',
  'framework-environment-deepen': '环境深化',
}

const FRAMEWORK_PROFILE_META: Record<Exclude<TextRoutingMode, 'custom'>, { label: string; description: string }> = {
  economy: { label: '省钱', description: '主力模型完成结构与深化，低成本模型只负责环境识别。' },
  balanced: { label: '平衡（推荐）', description: '主力模型维护故事结构，角色由更擅长文字表达的模型深化。' },
  quality: { label: '高质量', description: '关键结构、梗概和逐幕深化使用更强模型，规则提取仍控制成本。' },
}

const VISUAL_LABELS: Record<VisualTextStageId, string> = {
  'style-prompt': '画风方案与提示词',
  'character-prompt': '角色母版提示词',
  'concept-prompt': '概念场景提示词',
}

const VISUAL_PROFILE_META: Record<Exclude<TextRoutingMode, 'custom'>, { label: string; description: string }> = {
  economy: { label: '省钱', description: '主力模型完成三类专业提示词，避免为规则明确的转换任务使用旗舰模型。' },
  balanced: { label: '平衡（推荐）', description: '画风与角色提示词使用专业主力模型，概念场景由导演型主力模型完成。' },
  quality: { label: '高质量', description: '关键画风与概念场景使用更强模型，角色提示词仍由专业主力模型执行。' },
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

type FrameworkCandidateTable = Record<FrameworkTextStageId, readonly string[]>
const FRAMEWORK_ROUTES: Record<Exclude<TextRoutingMode, 'custom'>, FrameworkCandidateTable> = {
  economy: {
    'framework-base': ['gpt-6.1-sol', 'gpt-4o', 'claude-sonnet-5-5'],
    'framework-character': ['gpt-6.1-sol', 'deepseek-v4.1-flash', 'deepseek-v3-1'],
    'framework-synopsis': ['gpt-6.1-sol', 'deepseek-v4.1-flash', 'deepseek-v3-1'],
    'framework-act': ['gpt-6.1-sol', 'deepseek-v4-pro', 'deepseek-v3-1'],
    'framework-environment-extract': ['gpt-6-luna', 'claude-haiku-5-5', 'deepseek-v4.1-flash'],
    'framework-environment-deepen': ['gpt-6.1-sol', 'deepseek-v4.1-flash', 'deepseek-v3-1'],
  },
  balanced: {
    'framework-base': ['gpt-6.1-sol', 'gpt-6-astra', 'claude-sonnet-5-5'],
    'framework-character': ['claude-sonnet-5-5', 'gpt-6.1-sol', 'deepseek-v4-pro'],
    'framework-synopsis': ['gpt-6.1-sol', 'claude-sonnet-5-5', 'deepseek-v4-pro'],
    'framework-act': ['gpt-6.1-sol', 'gpt-6-astra', 'claude-opus-5-5'],
    'framework-environment-extract': ['gpt-6-luna', 'claude-haiku-5-5', 'deepseek-v4.1-flash'],
    'framework-environment-deepen': ['gpt-6.1-sol', 'claude-sonnet-5-5', 'deepseek-v4-pro'],
  },
  quality: {
    'framework-base': ['gpt-6-astra', 'claude-opus-5-5', 'gpt-6.1-sol'],
    'framework-character': ['claude-sonnet-5-5', 'claude-opus-5-5', 'gpt-6.1-sol'],
    'framework-synopsis': ['claude-opus-5-5', 'gpt-6-astra', 'gpt-6.1-sol'],
    'framework-act': ['gpt-6-astra', 'claude-opus-5-5', 'gpt-6.1-sol'],
    'framework-environment-extract': ['gpt-6.1-sol', 'gpt-6-luna', 'claude-haiku-5-5'],
    'framework-environment-deepen': ['claude-sonnet-5-5', 'gpt-6.1-sol', 'deepseek-v4-pro'],
  },
}

type VisualCandidateTable = Record<VisualTextStageId, readonly string[]>
const VISUAL_ROUTES: Record<Exclude<TextRoutingMode, 'custom'>, VisualCandidateTable> = {
  economy: {
    'style-prompt': ['gpt-6.1-sol', 'gpt-4o', 'claude-sonnet-5-5'],
    'character-prompt': ['gpt-6.1-sol', 'deepseek-v4.1-flash', 'deepseek-v3-1'],
    'concept-prompt': ['gpt-6.1-sol', 'deepseek-v4-pro', 'gpt-4o'],
  },
  balanced: {
    'style-prompt': ['claude-sonnet-5-5', 'gpt-6.1-sol', 'gpt-4o'],
    'character-prompt': ['claude-sonnet-5-5', 'gpt-6.1-sol', 'deepseek-v4-pro'],
    'concept-prompt': ['gpt-6.1-sol', 'claude-sonnet-5-5', 'gpt-4o'],
  },
  quality: {
    'style-prompt': ['gpt-6-astra', 'claude-opus-5-5', 'claude-sonnet-5-5'],
    'character-prompt': ['claude-sonnet-5-5', 'gpt-6.1-sol', 'claude-opus-5-5'],
    'concept-prompt': ['gpt-6-astra', 'claude-opus-5-5', 'gpt-6.1-sol'],
  },
}

// OpenLux public pricing snapshot, USD per one million input/output tokens.
// It is deliberately dated and shown as an estimate; billing reconciliation must use provider usage.
export const TEXT_PRICE_SNAPSHOT_DATE = '2026-10-30'
const PRICE_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  'gpt-6-luna': { input: 0.0059, output: 0.0294 },
  'gpt-6.1-sol': { input: 0.0735, output: 0.3677 },
  'gpt-6-astra': { input: 0.3677, output: 1.838 },
  'gpt-4o': { input: 0.11, output: 0.44 },
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

const FRAMEWORK_TOKEN_RANGES: Record<FrameworkTextStageId, { input: [number, number]; output: [number, number]; multiplier: number }> = {
  'framework-base': { input: [12000, 25000], output: [3000, 8000], multiplier: 1 },
  'framework-character': { input: [3000, 8000], output: [1000, 3000], multiplier: 2 },
  'framework-synopsis': { input: [6000, 12000], output: [2000, 5000], multiplier: 1 },
  'framework-act': { input: [7000, 14000], output: [2000, 5000], multiplier: 3 },
  'framework-environment-extract': { input: [5000, 10000], output: [1000, 2500], multiplier: 1 },
  'framework-environment-deepen': { input: [5000, 10000], output: [1000, 3000], multiplier: 2 },
}

const VISUAL_TOKEN_RANGES: Record<VisualTextStageId, { input: [number, number]; output: [number, number] }> = {
  'style-prompt': { input: [5000, 12000], output: [1200, 3500] },
  'character-prompt': { input: [5000, 12000], output: [1200, 3500] },
  'concept-prompt': { input: [6000, 14000], output: [1500, 4000] },
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

export function buildFrameworkTextRoutingSnapshot(
  mode: Exclude<TextRoutingMode, 'custom'>,
  availableModelIds: string[],
  now = new Date(),
): FrameworkTextRoutingSnapshot {
  const available = new Set(availableModelIds)
  const stages = FRAMEWORK_TEXT_STAGE_IDS.map((id) => {
    const model = chooseAvailable(FRAMEWORK_ROUTES[mode][id], available)
    if (!model) throw new Error(`FRAMEWORK_TEXT_ROUTING_MODEL_UNAVAILABLE:${mode}:${id}`)
    return { id, label: FRAMEWORK_LABELS[id], model }
  })
  let min = 0
  let max = 0
  for (const stage of stages) {
    const range = FRAMEWORK_TOKEN_RANGES[stage.id]
    const cost = estimateCall(stage.model, range)
    if (!cost) throw new Error(`TEXT_ROUTING_PRICE_UNAVAILABLE:${stage.model}`)
    min += cost.min * range.multiplier
    max += cost.max * range.multiplier
  }
  return {
    mode,
    ...FRAMEWORK_PROFILE_META[mode],
    catalogCheckedAt: now.toISOString(),
    priceSnapshotDate: TEXT_PRICE_SNAPSHOT_DATE,
    stages,
    workloadAssumption: { characters: 2, acts: 3, environments: 2, totalCalls: 10 },
    estimatedCostUsd: { min: roundUsd(min), max: roundUsd(max) },
  }
}

export function buildFrameworkTextRoutingPreviews(availableModelIds: string[]): FrameworkTextRoutingProfilePreview[] {
  return (['economy', 'balanced', 'quality'] as const).flatMap((mode) => {
    try {
      const snapshot = buildFrameworkTextRoutingSnapshot(mode, availableModelIds)
      return [{
        mode,
        label: snapshot.label,
        description: snapshot.description,
        stages: snapshot.stages,
        workloadLabel: '按 2 个角色、3 幕、2 个主要环境估算，共约 10 次文字调用',
        estimatedCostUsd: snapshot.estimatedCostUsd,
        priceSnapshotDate: snapshot.priceSnapshotDate,
      }]
    } catch {
      return []
    }
  })
}

export function modelForFrameworkStage(
  snapshot: FrameworkTextRoutingSnapshot | null | undefined,
  stageId: FrameworkTextStageId,
  legacyModel: string,
): string {
  return snapshot?.stages.find((stage) => stage.id === stageId)?.model || legacyModel
}

export function buildVisualTextRoutingSnapshot(
  mode: Exclude<TextRoutingMode, 'custom'>,
  availableModelIds: string[],
  now = new Date(),
): VisualTextRoutingSnapshot {
  const available = new Set(availableModelIds)
  const stages = VISUAL_TEXT_STAGE_IDS.map((id) => {
    const model = chooseAvailable(VISUAL_ROUTES[mode][id], available)
    if (!model) throw new Error(`VISUAL_TEXT_ROUTING_MODEL_UNAVAILABLE:${mode}:${id}`)
    return { id, label: VISUAL_LABELS[id], model }
  })
  let min = 0
  let max = 0
  for (const stage of stages) {
    const cost = estimateCall(stage.model, VISUAL_TOKEN_RANGES[stage.id])
    if (!cost) throw new Error(`TEXT_ROUTING_PRICE_UNAVAILABLE:${stage.model}`)
    min += cost.min
    max += cost.max
  }
  return {
    mode,
    ...VISUAL_PROFILE_META[mode],
    catalogCheckedAt: now.toISOString(),
    priceSnapshotDate: TEXT_PRICE_SNAPSHOT_DATE,
    stages,
    estimatedCostUsd: { min: roundUsd(min), max: roundUsd(max) },
  }
}

export function buildVisualTextRoutingPreviews(availableModelIds: string[]): VisualTextRoutingProfilePreview[] {
  return (['economy', 'balanced', 'quality'] as const).flatMap((mode) => {
    try {
      const snapshot = buildVisualTextRoutingSnapshot(mode, availableModelIds)
      return [{
        mode: snapshot.mode,
        label: snapshot.label,
        description: snapshot.description,
        stages: snapshot.stages,
        estimatedCostUsd: snapshot.estimatedCostUsd,
        priceSnapshotDate: snapshot.priceSnapshotDate,
        workloadLabel: '画风、角色、概念场景各 1 次文字调用，共 3 次',
      }]
    } catch {
      return []
    }
  })
}

export function modelForVisualStage(
  snapshot: VisualTextRoutingSnapshot | null | undefined,
  stageId: VisualTextStageId,
  legacyModel: string,
): string {
  return snapshot?.stages.find((stage) => stage.id === stageId)?.model || legacyModel
}
