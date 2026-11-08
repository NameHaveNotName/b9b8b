export const KEYFRAME_COVERAGE_STATUSES = [
  'COVERED',
  'DERIVABLE',
  'NEEDS_KEYFRAME',
  'POST_ONLY',
] as const

export type KeyframeCoverageStatus = (typeof KEYFRAME_COVERAGE_STATUSES)[number]

export type KeyframeCoverageShot = {
  shotId?: unknown
  actNumber?: unknown
  generationUnitId?: unknown
  actionChainId?: unknown
  firstFrameUrl?: unknown
  referenceImageUrl?: unknown
  imageUrl?: unknown
  lastFrameUrl?: unknown
}

export type KeyframeCoverageOverride = {
  shotId?: unknown
  actNumber?: unknown
  status?: unknown
  note?: unknown
  updatedAt?: unknown
  updatedById?: unknown
}

export type KeyframeCoverageRow = {
  shotId: string
  actNumber: number
  status: KeyframeCoverageStatus
  note: string
  source: 'AUTO' | 'HUMAN'
  evidence: string[]
  groupKey: string | null
  hardGap: boolean
  updatedAt?: string
  updatedById?: string
}

export type KeyframeCoverageSummary = {
  total: number
  covered: number
  derivable: number
  needsKeyframe: number
  postOnly: number
  hardGapCount: number
  readyForVideo: boolean
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function actNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function keyframeCoverageKey(shotId: string, act: number): string {
  return `${act}|${shotId}`
}

function explicitGroupKey(shot: KeyframeCoverageShot): string | null {
  const unit = text(shot.generationUnitId)
  if (unit) return `unit:${unit}`
  const chain = text(shot.actionChainId)
  if (chain) return `chain:${chain}`
  return null
}

function mediaEvidence(shot: KeyframeCoverageShot, keyframe?: KeyframeCoverageShot): string[] {
  const evidence: string[] = []
  if (
    text(shot.firstFrameUrl)
    || text(shot.referenceImageUrl)
    || text(shot.imageUrl)
    || text(keyframe?.firstFrameUrl)
    || text(keyframe?.referenceImageUrl)
    || text(keyframe?.imageUrl)
  ) evidence.push('首帧')
  if (text(shot.lastFrameUrl) || text(keyframe?.lastFrameUrl)) evidence.push('尾帧')
  return evidence
}

export function sanitizeCoverageOverrides(value: unknown): KeyframeCoverageOverride[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: KeyframeCoverageOverride[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as KeyframeCoverageOverride
    const shotId = text(raw.shotId)
    const act = actNumber(raw.actNumber)
    const status = text(raw.status) as KeyframeCoverageStatus
    if (!shotId || !KEYFRAME_COVERAGE_STATUSES.includes(status)) continue
    const key = keyframeCoverageKey(shotId, act)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      shotId,
      actNumber: act,
      status,
      note: text(raw.note).slice(0, 500),
      updatedAt: text(raw.updatedAt) || undefined,
      updatedById: text(raw.updatedById) || undefined,
    })
  }
  return result
}

export function summarizeKeyframeCoverage(rows: KeyframeCoverageRow[]): KeyframeCoverageSummary {
  const count = (status: KeyframeCoverageStatus) => rows.filter((row) => row.status === status).length
  const needsKeyframe = count('NEEDS_KEYFRAME')
  return {
    total: rows.length,
    covered: count('COVERED'),
    derivable: count('DERIVABLE'),
    needsKeyframe,
    postOnly: count('POST_ONLY'),
    hardGapCount: needsKeyframe,
    readyForVideo: rows.length > 0 && needsKeyframe === 0,
  }
}

/**
 * Build a conservative coverage matrix. Only an explicit generation-unit or
 * action-chain relationship may make an unillustrated shot derivable.
 */
export function buildKeyframeCoverageReview(input: {
  shots: KeyframeCoverageShot[]
  keyframes?: KeyframeCoverageShot[]
  overrides?: unknown
}): { rows: KeyframeCoverageRow[]; summary: KeyframeCoverageSummary } {
  const keyframes = new Map<string, KeyframeCoverageShot>()
  for (const frame of input.keyframes || []) {
    const shotId = text(frame.shotId)
    if (shotId) keyframes.set(keyframeCoverageKey(shotId, actNumber(frame.actNumber)), frame)
  }
  const overrides = new Map<string, KeyframeCoverageOverride>()
  for (const override of sanitizeCoverageOverrides(input.overrides)) {
    overrides.set(keyframeCoverageKey(text(override.shotId), actNumber(override.actNumber)), override)
  }

  const groupHasAnchor = new Set<string>()
  for (const shot of input.shots || []) {
    const shotId = text(shot.shotId)
    const group = explicitGroupKey(shot)
    if (!shotId || !group) continue
    const evidence = mediaEvidence(shot, keyframes.get(keyframeCoverageKey(shotId, actNumber(shot.actNumber))))
    if (evidence.length > 0) groupHasAnchor.add(group)
  }

  const rows: KeyframeCoverageRow[] = []
  for (const shot of input.shots || []) {
    const shotId = text(shot.shotId)
    if (!shotId) continue
    const act = actNumber(shot.actNumber)
    const key = keyframeCoverageKey(shotId, act)
    const groupKey = explicitGroupKey(shot)
    const evidence = mediaEvidence(shot, keyframes.get(key))
    const override = overrides.get(key)
    let status: KeyframeCoverageStatus
    let source: 'AUTO' | 'HUMAN'
    let note = ''
    if (override) {
      status = text(override.status) as KeyframeCoverageStatus
      source = 'HUMAN'
      note = text(override.note)
    } else if (evidence.length > 0) {
      status = 'COVERED'
      source = 'AUTO'
      note = '已有可核对的首帧或尾帧。'
    } else if (groupKey && groupHasAnchor.has(groupKey)) {
      status = 'DERIVABLE'
      source = 'AUTO'
      note = '同一明确生成单元或动作链已有构图锚点，可由现有素材推导。'
      evidence.push('同单元构图锚点')
    } else {
      status = 'NEEDS_KEYFRAME'
      source = 'AUTO'
      note = '没有画面证据，也没有可安全继承的明确生成单元或动作链锚点。'
    }
    rows.push({
      shotId,
      actNumber: act,
      status,
      note,
      source,
      evidence,
      groupKey,
      hardGap: status === 'NEEDS_KEYFRAME',
      updatedAt: text(override?.updatedAt) || undefined,
      updatedById: text(override?.updatedById) || undefined,
    })
  }
  return { rows, summary: summarizeKeyframeCoverage(rows) }
}
