export const VIDEO_EVIDENCE_DISPOSITIONS = [
  'PENDING',
  'WHOLE_CLIP',
  'USABLE_RANGE',
  'VISUAL_ONLY',
  'SUBJECT_ONLY',
  'REJECTED',
] as const

export type VideoEvidenceDisposition = (typeof VIDEO_EVIDENCE_DISPOSITIONS)[number]

export type NormalizedVideoEvidenceReview = {
  disposition: Exclude<VideoEvidenceDisposition, 'PENDING'>
  usableStartMs: number | null
  usableEndMs: number | null
  reviewNote: string
}

export class VideoEvidenceValidationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function finiteMilliseconds(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

export function buildContactSheetFrameTimes(durationMs: number, count = 9): number[] {
  const safeDuration = Math.max(1, Math.round(durationMs))
  const safeCount = Math.max(1, Math.min(25, Math.round(count)))
  if (safeCount === 1) return [Math.round(safeDuration / 2)]
  return Array.from({ length: safeCount }, (_, index) => (
    Math.round((safeDuration * index) / safeCount)
  ))
}

export function normalizeVideoEvidenceReview(
  value: unknown,
  durationMs: number
): NormalizedVideoEvidenceReview {
  if (!value || typeof value !== 'object') {
    throw new VideoEvidenceValidationError('INVALID_REVIEW', '缺少素材处置结论')
  }
  const input = value as Record<string, unknown>
  const disposition = String(input.disposition || '').trim().toUpperCase() as VideoEvidenceDisposition
  if (!VIDEO_EVIDENCE_DISPOSITIONS.includes(disposition) || disposition === 'PENDING') {
    throw new VideoEvidenceValidationError('INVALID_DISPOSITION', '请选择明确的素材处置结论')
  }
  const reviewNote = typeof input.reviewNote === 'string' ? input.reviewNote.trim().slice(0, 2000) : ''
  if (disposition === 'REJECTED') {
    return { disposition, usableStartMs: null, usableEndMs: null, reviewNote }
  }

  const safeDuration = Math.max(1, Math.round(durationMs))
  if (disposition === 'WHOLE_CLIP') {
    return { disposition, usableStartMs: 0, usableEndMs: safeDuration, reviewNote }
  }
  const usableStartMs = finiteMilliseconds(input.usableStartMs)
  const usableEndMs = finiteMilliseconds(input.usableEndMs)
  if (
    usableStartMs == null
    || usableEndMs == null
    || usableStartMs < 0
    || usableEndMs > safeDuration
    || usableEndMs <= usableStartMs
  ) {
    throw new VideoEvidenceValidationError(
      'INVALID_USABLE_RANGE',
      `可用区间必须位于 0 到 ${(safeDuration / 1000).toFixed(2)} 秒内，且结束时间晚于开始时间`
    )
  }
  return { disposition, usableStartMs, usableEndMs, reviewNote }
}

export function evidenceDispositionCanEnterTimeline(disposition: unknown): boolean {
  return disposition === 'WHOLE_CLIP'
    || disposition === 'USABLE_RANGE'
    || disposition === 'VISUAL_ONLY'
    || disposition === 'SUBJECT_ONLY'
}

export function buildAdoptedTimelineRange(input: {
  clipDurationMs: number
  sourceStartMs?: number
  sourceEndMs?: number
  timelineStartMs: number
  previousDurationMs: number
}) {
  const clipDurationMs = Math.max(1, Math.round(input.clipDurationMs))
  const sourceStartMs = Math.max(0, Math.round(input.sourceStartMs ?? 0))
  const sourceEndMs = Math.min(clipDurationMs, Math.round(input.sourceEndMs ?? clipDurationMs))
  if (sourceEndMs <= sourceStartMs) {
    throw new VideoEvidenceValidationError('INVALID_ADOPTION_SOURCE_RANGE', '采用区间无效')
  }
  const durationMs = sourceEndMs - sourceStartMs
  return {
    sourceStartMs,
    sourceEndMs,
    durationMs,
    timelineEndMs: input.timelineStartMs + durationMs,
    durationDeltaMs: durationMs - input.previousDurationMs,
  }
}
