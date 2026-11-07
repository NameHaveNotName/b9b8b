export type VideoQualityDecision = 'HUMAN_REVIEW' | 'DELIVERY_FAILED'

/** Quality scoring never adopts footage. Timeline admission requires a separate user action. */
export function isQualityDecisionApprovedForTimeline(decision: string): boolean {
  void decision
  return false
}

export interface VideoQualitySignals {
  expectedDurationMs: number
  actualDurationMs: number
  isMock: boolean
  hasVideoStream?: boolean
  blackFrameRatio?: number | null
  freezeFrameRatio?: number | null
  identityWardrobe?: number | null
  actionTemporal?: number | null
  promptStory?: number | null
  lightingStyle?: number | null
  compositionRhythm?: number | null
  tier?: 'hero' | 'standard' | 'budget' | null
  strategy?: 'SINGLE_SHOT' | 'MULTI_SHOT' | null
}

export interface VideoQualityResult {
  decision: VideoQualityDecision
  overallScore: number
  confidence: number
  scores: {
    identityWardrobe: number | null
    actionTemporal: number | null
    promptStory: number | null
    lightingStyle: number | null
    compositionRhythm: number | null
    technical: number
  }
  reasons: string[]
}

const WEIGHTS = {
  identityWardrobe: 0.25,
  actionTemporal: 0.2,
  promptStory: 0.2,
  lightingStyle: 0.15,
  compositionRhythm: 0.1,
  technical: 0.1,
} as const

function boundedScore(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Produce an advisory 100-point report. It never triggers adopt, retry, or fallback. */
export function assessVideoQuality(signals: VideoQualitySignals): VideoQualityResult {
  if (!Number.isFinite(signals.expectedDurationMs) || signals.expectedDurationMs <= 0) {
    throw new Error(`Invalid expectedDurationMs: ${signals.expectedDurationMs}`)
  }
  if (!Number.isFinite(signals.actualDurationMs) || signals.actualDurationMs <= 0) {
    throw new Error(`Invalid actualDurationMs: ${signals.actualDurationMs}`)
  }
  const reasons: string[] = []
  const deliveryFailed = signals.hasVideoStream === false || signals.isMock
  let technical = deliveryFailed ? 0 : 100
  if (signals.hasVideoStream === false) reasons.push('未检测到可播放的视频流。')
  if (signals.isMock) reasons.push('供应商未返回正式视频，当前仅有本地占位素材。')

  const durationDeviation = Math.abs(signals.actualDurationMs - signals.expectedDurationMs)
    / signals.expectedDurationMs
  if (durationDeviation > 0.3) {
    technical -= 25
    reasons.push('实际时长与计划时长偏差超过 30%。')
  }
  const blackFrameRatio = Math.max(0, Math.min(1, signals.blackFrameRatio || 0))
  const freezeFrameRatio = Math.max(0, Math.min(1, signals.freezeFrameRatio || 0))
  if (blackFrameRatio > 0.2) {
    technical -= 35
    reasons.push('黑帧比例超过 20%。')
  }
  if (freezeFrameRatio > 0.8) {
    technical -= 30
    reasons.push('冻结画面比例超过 80%。')
  }
  technical = Math.max(0, technical)

  const scores = {
    identityWardrobe: boundedScore(signals.identityWardrobe),
    actionTemporal: boundedScore(signals.actionTemporal),
    promptStory: boundedScore(signals.promptStory),
    lightingStyle: boundedScore(signals.lightingStyle),
    compositionRhythm: boundedScore(signals.compositionRhythm),
    technical: round(technical),
  }
  let weightedScore = 0
  let availableWeight = 0
  for (const [key, weight] of Object.entries(WEIGHTS) as Array<[keyof typeof WEIGHTS, number]>) {
    const score = scores[key]
    if (score == null) continue
    weightedScore += score * weight
    availableWeight += weight
  }
  const overallScore = availableWeight > 0 ? round(weightedScore / availableWeight) : 0
  const confidence = round(availableWeight)
  if (!deliveryFailed && availableWeight < 1) {
    reasons.push('语义评分尚未完整；当前总分仅基于已有证据，不会触发任何自动操作。')
  }
  if (reasons.length === 0) reasons.push('未发现已检查维度中的明显问题；是否采用仍由用户决定。')
  return {
    decision: deliveryFailed ? 'DELIVERY_FAILED' : 'HUMAN_REVIEW',
    overallScore,
    confidence,
    scores,
    reasons,
  }
}
