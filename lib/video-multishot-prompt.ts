export interface MultiShotPromptShot {
  shotId: string
  durationMs: number
  prompt: string
  referenceImageIndex?: number | null
  referenceImageIndices?: number[]
  transitionAfter?: 'hard-cut' | 'match-cut' | 'whip-pan' | 'dissolve' | null
}

export interface CompiledMultiShotPrompt {
  prompt: string
  durationMs: number
  shotCount: number
  timeline: Array<{
    shotId: string
    startMs: number
    endMs: number
    referenceImageIndices?: number[]
  }>
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)
}

/** Compile a deterministic, inspectable long-form prompt without provider I/O. */
export function compileMultiShotPrompt(args: {
  shots: MultiShotPromptShot[]
  maxDurationMs: number
  /** Only set when the provider publishes a real per-request shot-count limit. */
  providerHardShotLimit?: number
  referenceImageCount: number
  referenceAuthorityMap?: string
}): CompiledMultiShotPrompt {
  if (args.shots.length < 2) throw new Error('Multi-shot prompt requires at least two shots')
  if (args.providerHardShotLimit != null && args.shots.length > args.providerHardShotLimit) {
    throw new Error(`Shot count ${args.shots.length} exceeds provider limit ${args.providerHardShotLimit}`)
  }
  const ids = new Set<string>()
  let cursor = 0
  const timeline = args.shots.map((shot) => {
    if (!shot.shotId || ids.has(shot.shotId)) throw new Error(`Duplicate or empty shot id: ${shot.shotId}`)
    ids.add(shot.shotId)
    if (!Number.isInteger(shot.durationMs) || shot.durationMs <= 0) {
      throw new Error(`Invalid duration for ${shot.shotId}: ${shot.durationMs}`)
    }
    if (!shot.prompt.trim()) throw new Error(`Missing prompt for ${shot.shotId}`)
    const referenceImageIndices = [...new Set([
      ...(shot.referenceImageIndices || []),
      ...(shot.referenceImageIndex != null ? [shot.referenceImageIndex] : []),
    ])]
    if (referenceImageIndices.some((referenceIndex) =>
      !Number.isInteger(referenceIndex)
      || referenceIndex < 1
      || referenceIndex > args.referenceImageCount
    )) {
      throw new Error(`Invalid reference image index for ${shot.shotId}: ${referenceImageIndices.join(',')}`)
    }
    const item = {
      shotId: shot.shotId,
      startMs: cursor,
      endMs: cursor + shot.durationMs,
      ...(referenceImageIndices.length ? { referenceImageIndices } : {}),
    }
    cursor = item.endMs
    return item
  })
  if (cursor > args.maxDurationMs) {
    throw new Error(`Multi-shot duration ${cursor}ms exceeds limit ${args.maxDurationMs}ms`)
  }

  const lines = [
    'Create one coherent cinematic video containing the following intentional editorial shots in exact order.',
    'Preserve character identity, wardrobe, environment logic, lighting direction, and visual style across every cut.',
    'Do not add captions, subtitles, logos, borders, or extra shots.',
  ]
  if (args.referenceAuthorityMap?.trim()) lines.push(args.referenceAuthorityMap.trim())
  args.shots.forEach((shot, index) => {
    const time = timeline[index]
    const referenceIndices = time.referenceImageIndices || []
    const reference = referenceIndices.length
      ? ` Use reference image(s) ${referenceIndices.join(', ')} only according to the reference authority map.`
      : ''
    lines.push(
      `SHOT ${index + 1} [${seconds(time.startMs)}s-${seconds(time.endMs)}s]: ${shot.prompt.trim()}${reference}`
    )
    if (index < args.shots.length - 1) {
      const transition = shot.transitionAfter || 'hard-cut'
      lines.push(`TRANSITION ${index + 1}->${index + 2}: ${transition}.`)
    }
  })
  lines.push(`End precisely at ${seconds(cursor)} seconds after completing SHOT ${args.shots.length}.`)
  return { prompt: lines.join('\n'), durationMs: cursor, shotCount: args.shots.length, timeline }
}
