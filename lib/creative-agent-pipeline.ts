import type { WebSearchResult, WebSearchSource } from '@/lib/api-clients/openlux'

export const CREATIVE_AGENT_SCHEMA_VERSION = 1 as const
export const CREATIVE_AGENT_SEARCH_MODEL = 'gpt-5-search-api'
export const CREATIVE_AGENT_MAX_SOURCES = 12

export type CreativeAgentStageStatus = 'completed' | 'failed'

export interface CreativeAgentStage {
  id: string
  label: string
  summary: string
  status: CreativeAgentStageStatus
  output: unknown
  children?: CreativeAgentStage[]
}
export interface CreativeAgentRun {
  schemaVersion: typeof CREATIVE_AGENT_SCHEMA_VERSION
  status: 'AWAITING_CONFIRMATION'
  goalInput: string
  stages: CreativeAgentStage[]
  sources: WebSearchSource[]
  artifacts: {
    goalContract: Record<string, unknown>
    researchBundle: Record<string, unknown>
    strategyMap: Record<string, unknown>
    conceptCandidates: Record<string, unknown>[]
    critiqueReport: Record<string, unknown>
    creativePlan: Record<string, unknown>
  }
}
interface PipelineAdapters {
  text: (prompt: string, stage?: { id: string; label: string }) => Promise<string>
  search: (prompt: string, stage?: { id: string; label: string }) => Promise<WebSearchResult>
}

export const CREATIVE_AGENT_PHASES = [
  'goal-contract',
  'research',
  'strategy-map',
  'concepts',
  'critique',
  'creative-plan',
] as const
export type CreativeAgentPhase = typeof CREATIVE_AGENT_PHASES[number]

export interface CreativeAgentCheckpoint {
  schemaVersion: typeof CREATIVE_AGENT_SCHEMA_VERSION
  goalInput: string
  creativeBrief: string
  referenceLabels: string[]
  completedPhases: CreativeAgentPhase[]
  stages: CreativeAgentStage[]
  sources: WebSearchSource[]
  artifacts: Partial<CreativeAgentRun['artifacts']>
}

function parseObject(text: string, stage: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced || text).trim()
  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object')
    return parsed
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      } catch { /* handled below */ }
    }
    throw new Error(`CREATIVE_AGENT_INVALID_JSON:${stage}`)
  }
}

function compact(value: unknown, max = 10000): string {
  return JSON.stringify(value).slice(0, max)
}

function summaryOf(value: Record<string, unknown>, fallback: string): string {
  for (const key of ['summary', 'conclusion', 'goalSummary', 'recommendedDirection', 'title']) {
    const item = value[key]
    if (typeof item === 'string' && item.trim()) return item.trim().slice(0, 180)
  }
  return fallback
}

function collectSources(results: WebSearchResult[]): WebSearchSource[] {
  const seen = new Set<string>()
  const merged: WebSearchSource[] = []
  for (const result of results) {
    for (const source of result.sources) {
      if (!source.url || seen.has(source.url)) continue
      seen.add(source.url)
      merged.push(source)
      if (merged.length >= CREATIVE_AGENT_MAX_SOURCES) return merged
    }
  }
  return merged
}

const JSON_RULE = '只输出一个有效 JSON 对象，不要 Markdown，不要补造事实；不确定内容放入 assumptions 或 verificationNeeded。'

export function createCreativeAgentCheckpoint(input: { goal: string; creativeBrief: string; referenceLabels?: string[] }): CreativeAgentCheckpoint {
  const goalInput = input.goal.trim()
  if (goalInput.length < 10) throw new Error('BUSINESS_GOAL_TOO_SHORT')
  return {
    schemaVersion: CREATIVE_AGENT_SCHEMA_VERSION,
    goalInput,
    creativeBrief: input.creativeBrief.trim(),
    referenceLabels: input.referenceLabels || [],
    completedPhases: [],
    stages: [],
    sources: [],
    artifacts: {},
  }
}

export function getNextCreativeAgentPhase(checkpoint: CreativeAgentCheckpoint): CreativeAgentPhase | null {
  return CREATIVE_AGENT_PHASES.find((phase) => !checkpoint.completedPhases.includes(phase)) || null
}

function completeCheckpointPhase(
  checkpoint: CreativeAgentCheckpoint,
  phase: CreativeAgentPhase,
  stage: CreativeAgentStage,
  artifacts: Partial<CreativeAgentRun['artifacts']>,
  sources = checkpoint.sources,
): CreativeAgentCheckpoint {
  return {
    ...checkpoint,
    completedPhases: [...checkpoint.completedPhases, phase],
    stages: [...checkpoint.stages, stage],
    sources,
    artifacts: { ...checkpoint.artifacts, ...artifacts },
  }
}

export async function runCreativeAgentPhase(
  checkpoint: CreativeAgentCheckpoint,
  adapters: PipelineAdapters,
): Promise<CreativeAgentCheckpoint> {
  const phase = getNextCreativeAgentPhase(checkpoint)
  if (!phase) return checkpoint
  const brief = checkpoint.creativeBrief

  if (phase === 'goal-contract') {
    const goalContract = parseObject(await adapters.text(`你是创作任务定义 Agent。把用户的自然语言目标整理成可执行目标契约，适用于剧情片、故事片、品牌宣传、产品带货、官方任务等任意类型。不要预设主角必须是人，也可以是动物、物品、产品或抽象主体。
${JSON_RULE}
字段必须包含：summary, contentType, primaryOutcome, audience, platform, hardConstraints, successCriteria, verificationNeeded, narrativeSubjectCandidates。
用户目标：${checkpoint.goalInput}
创作简介：${brief}
参考资产标签：${checkpoint.referenceLabels.join('、') || '无'}`, { id: 'goal-contract', label: '理解目标' }), 'goal-contract')
    return completeCheckpointPhase(checkpoint, phase, { id: phase, label: '理解目标', summary: summaryOf(goalContract, '已形成目标契约'), status: 'completed', output: goalContract }, { goalContract })
  }

  const goalContract = checkpoint.artifacts.goalContract
  if (!goalContract) throw new Error('CREATIVE_AGENT_CHECKPOINT_MISSING:goal-contract')
  if (phase === 'research') {
    const researchSpecs = [
      ['subject-facts', '主体与事实', '核实任务涉及的品牌、机构、产品、题材事实、视觉标识与不可出错项；优先官方或一手来源。'],
      ['audience-context', '平台与受众', '研究目标平台的内容语境、受众痛点、竞品/同类优质表达；区分事实、经验判断和假设。'],
      ['audiovisual-form', '视听形式', '研究适合该任务的叙事、节奏、视听形式与制作约束；寻找可借鉴但不照搬的案例。'],
    ] as const
    const researchResults = await Promise.all(researchSpecs.map(async ([id, label, focus]) => {
      const result = await adapters.search(`你是联网研究 Agent。${focus}
目标契约：${compact(goalContract)}
创作简介：${brief}
输出清晰的研究结论、证据对应关系、仍需核实事项。不要下载图片；如发现可能有帮助的图片，只列所在页面或候选图片 URL，并明确版权状态未知、需人工确认。`, { id: `research-${id}`, label: `联网研究 · ${label}` })
      return { id, label, result }
    }))
    const children = researchResults.map(({ id, label, result }) => ({ id, label, summary: result.text.replace(/\s+/g, ' ').slice(0, 180), status: 'completed' as const, output: { findings: result.text, sources: result.sources } }))
    const researchBundle = Object.fromEntries(researchResults.map(({ id, result }) => [id, { findings: result.text, sources: result.sources }]))
    const sources = collectSources(researchResults.map((item) => item.result))
    return completeCheckpointPhase(checkpoint, phase, { id: phase, label: '联网研究', summary: `三路研究完成，共保留 ${sources.length} 个有效来源`, status: 'completed', output: researchBundle, children }, { researchBundle }, sources)
  }

  const researchBundle = checkpoint.artifacts.researchBundle
  if (!researchBundle) throw new Error('CREATIVE_AGENT_CHECKPOINT_MISSING:research')
  if (phase === 'strategy-map') {
    const strategyMap = parseObject(await adapters.text(`你是策略分析 Agent。检查研究是否足以支撑目标，并将事实、推断和待验证项分开，形成跨题材可用的策略地图。
${JSON_RULE}
字段必须包含：summary, audienceInsight, communicationPriority, narrativeOpportunity, platformFit, mustShow, mustAvoid, evidenceGaps, evaluationRubric。
目标契约：${compact(goalContract)}
研究资料：${compact(researchBundle, 26000)}`, { id: phase, label: '形成策略' }), phase)
    return completeCheckpointPhase(checkpoint, phase, { id: phase, label: '形成策略', summary: summaryOf(strategyMap, '已形成策略地图'), status: 'completed', output: strategyMap }, { strategyMap })
  }

  const strategyMap = checkpoint.artifacts.strategyMap
  if (!strategyMap) throw new Error('CREATIVE_AGENT_CHECKPOINT_MISSING:strategy-map')
  if (phase === 'concepts') {
    const conceptSpecs = [
      ['narrative-emotion', '叙事与情绪', '从故事结构、情绪曲线、角色或非人主体的行动出发，提出独特方案。'],
      ['audience-experience', '受众体验', '从开场吸引、理解成本、讨论/分享动机与行动路径出发，提出独特方案。'],
      ['audiovisual-production', '视听与制作', '从镜头、声音、节奏、可生成性和资产一致性出发，提出独特方案。'],
    ] as const
    const conceptCandidates = await Promise.all(conceptSpecs.map(async ([id, label, focus]) => {
      const value = parseObject(await adapters.text(`你是${label}创意 Agent。${focus}
不要照抄研究案例，不要把主角默认设定成人。${JSON_RULE}
字段必须包含：title, summary, coreIdea, opening, development, ending, audienceValue, risks, productionNotes。
目标契约：${compact(goalContract)}
策略地图：${compact(strategyMap)}
研究摘要：${compact(researchBundle, 18000)}`, { id: `concept-${id}`, label: `并行创意 · ${label}` }), `concept-${id}`)
      return { id, label, ...value }
    }))
    return completeCheckpointPhase(checkpoint, phase, {
      id: phase, label: '并行创意', summary: '三种不同视角的创意候选已完成', status: 'completed', output: conceptCandidates,
      children: conceptCandidates.map((item) => ({ id: String(item.id), label: String(item.label), summary: summaryOf(item, '创意候选'), status: 'completed', output: item })),
    }, { conceptCandidates })
  }

  const conceptCandidates = checkpoint.artifacts.conceptCandidates
  if (!conceptCandidates) throw new Error('CREATIVE_AGENT_CHECKPOINT_MISSING:concepts')
  if (phase === 'critique') {
    const critiqueReport = parseObject(await adapters.text(`你是严格但务实的创意评审 Agent。比较三个候选与目标、研究证据、执行难度的匹配度，指出冲突和取舍，不要简单平均拼接。
${JSON_RULE}
字段必须包含：summary, candidateScores, strongestElements, conflicts, factualRisks, productionRisks, recommendation。
目标契约：${compact(goalContract)}
策略地图：${compact(strategyMap)}
创意候选：${compact(conceptCandidates, 22000)}`, { id: phase, label: '交叉评审' }), phase)
    return completeCheckpointPhase(checkpoint, phase, { id: phase, label: '交叉评审', summary: summaryOf(critiqueReport, '已完成候选比较与风险审查'), status: 'completed', output: critiqueReport }, { critiqueReport })
  }

  const critiqueReport = checkpoint.artifacts.critiqueReport
  if (!critiqueReport) throw new Error('CREATIVE_AGENT_CHECKPOINT_MISSING:critique')
  const creativePlan = parseObject(await adapters.text(`你是最终方案归纳 Agent。基于目标、研究、策略、三个候选和评审，产出一份等待用户确认的完整创作方案。方案必须能继续指导叙事框架搭建，但此处不要直接生成正式框架。主角可为人、动物、产品、物品或抽象主体。
${JSON_RULE}
字段必须包含：title, summary, centralIdea, narrativeSubject, audienceAndPlatform, storyApproach, audiovisualApproach, keyBeats, requiredAssets, factualGuardrails, productionRisks, userDecisionPoints。
目标契约：${compact(goalContract)}
策略地图：${compact(strategyMap)}
候选：${compact(conceptCandidates, 20000)}
评审：${compact(critiqueReport)}`, { id: phase, label: '归纳方案' }), phase)
  return completeCheckpointPhase(checkpoint, phase, { id: phase, label: '归纳方案', summary: summaryOf(creativePlan, '完整创作方案等待确认'), status: 'completed', output: creativePlan }, { creativePlan })
}

export function finalizeCreativeAgentRun(checkpoint: CreativeAgentCheckpoint): CreativeAgentRun {
  if (getNextCreativeAgentPhase(checkpoint)) throw new Error('CREATIVE_AGENT_CHECKPOINT_INCOMPLETE')
  return {
    schemaVersion: CREATIVE_AGENT_SCHEMA_VERSION,
    status: 'AWAITING_CONFIRMATION',
    goalInput: checkpoint.goalInput,
    stages: checkpoint.stages,
    sources: checkpoint.sources,
    artifacts: checkpoint.artifacts as CreativeAgentRun['artifacts'],
  }
}

export async function runCreativeAgentPipeline(
  input: { goal: string; creativeBrief: string; referenceLabels?: string[] },
  adapters: PipelineAdapters,
): Promise<CreativeAgentRun> {
  let checkpoint = createCreativeAgentCheckpoint(input)
  while (getNextCreativeAgentPhase(checkpoint)) checkpoint = await runCreativeAgentPhase(checkpoint, adapters)
  return finalizeCreativeAgentRun(checkpoint)
}

export async function reviseCreativePlan(
  input: { currentPlan: Record<string, unknown>; userFeedback: string; goalContract?: Record<string, unknown> },
  text: (prompt: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  const feedback = input.userFeedback.trim()
  if (feedback.length < 2 || feedback.length > 2000) throw new Error('CREATIVE_PLAN_FEEDBACK_INVALID')
  return parseObject(await text(`你是创作方案修订 Agent。只根据用户意见修改当前完整创作方案，不重新执行目标分析、联网研究、并行创意或评审；没有被意见触及的部分必须保持稳定。不要新增未经研究支持的事实。
${JSON_RULE}
输出仍须包含：title, summary, centralIdea, narrativeSubject, audienceAndPlatform, storyApproach, audiovisualApproach, keyBeats, requiredAssets, factualGuardrails, productionRisks, userDecisionPoints。
目标契约：${compact(input.goalContract || {})}
当前方案：${compact(input.currentPlan, 18000)}
用户修改意见：${feedback}`), 'creative-plan-revision')
}
