import {
  buildShotProductionStructures,
  type ShotGroupingSource,
  type StoryboardShotStructureInput,
} from './video-shot-structure.ts'

export interface StoryCanvasShot extends StoryboardShotStructureInput {
  description?: unknown
  duration?: unknown
  generationUnitIntent?: unknown
}

export interface StoryCanvasUnit {
  key: string
  actNumber: number
  source: ShotGroupingSource
  label: string
  intent: string
  durationSeconds: number
  shots: Array<{
    lookupKey: string
    shotId: string
    description: string
    durationSeconds: number
  }>
}

export function parseCreativeDurationSeconds(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim().replace(/\s*(?:秒|s|sec|seconds?)\s*$/i, ''))
      : Number.NaN
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 10) / 10 : 0
}

/**
 * Build the read-only main-canvas representation from the same grouping truth
 * used by production planning. A canvas unit always represents one complete
 * provider output; its internal shots are visual beats, not post-generation cuts.
 */
export function buildStoryCanvasUnits(shots: StoryCanvasShot[]): StoryCanvasUnit[] {
  const structures = buildShotProductionStructures(shots)
  const units: StoryCanvasUnit[] = []

  shots.forEach((shot, index) => {
    const structure = structures[index]
    const actNumber = Number.isFinite(Number(shot.actNumber)) ? Number(shot.actNumber) : 1
    const durationSeconds = parseCreativeDurationSeconds(shot.duration)
    const previous = units[units.length - 1]
    const canAppend = previous
      && previous.key === structure.groupKey
      && previous.actNumber === actNumber
    const shotItem = {
      lookupKey: structure.lookupKey,
      shotId: String(shot.shotId || index + 1),
      description: typeof shot.description === 'string' ? shot.description : '',
      durationSeconds,
    }

    if (canAppend) {
      previous.shots.push(shotItem)
      previous.durationSeconds = Math.round((previous.durationSeconds + durationSeconds) * 10) / 10
      if (!previous.intent && typeof shot.generationUnitIntent === 'string') previous.intent = shot.generationUnitIntent.trim()
      return
    }

    const explicitLabel = typeof shot.generationUnitId === 'string' && shot.generationUnitId.trim()
      ? shot.generationUnitId.trim()
      : structure.source === 'explicit-action-chain' && typeof shot.actionChainId === 'string'
        ? shot.actionChainId.trim()
        : `单元 ${units.length + 1}`
    units.push({
      key: structure.groupKey,
      actNumber,
      source: structure.source,
      label: explicitLabel,
      intent: typeof shot.generationUnitIntent === 'string' ? shot.generationUnitIntent.trim() : '',
      durationSeconds,
      shots: [shotItem],
    })
  })

  return units
}
