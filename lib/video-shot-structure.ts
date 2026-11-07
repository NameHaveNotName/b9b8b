export interface StoryboardShotStructureInput {
  shotId?: unknown
  actNumber?: unknown
  sceneId?: unknown
  sceneName?: unknown
  locationId?: unknown
  locationName?: unknown
  timeOfDay?: unknown
  characters?: unknown
  generationUnitId?: unknown
  narrativeUnitId?: unknown
  actionChainId?: unknown
  continuityGroupId?: unknown
  continuityId?: unknown
  continuityFromPrevious?: unknown
  startsNewGenerationUnit?: unknown
  unitBoundaryReason?: unknown
}

export type ShotGroupingSource = 'explicit-unit' | 'explicit-action-chain' | 'scene-fallback' | 'isolated'

export interface ShotProductionStructure {
  lookupKey: string
  groupKey: string
  source: ShotGroupingSource
  sceneKey: string | null
  continuityKey: string | null
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
    : ''
}

function normalizedId(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    : ''
}

function actKey(value: unknown): string {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(numeric) : 'na'
}

export function storyboardShotLookupKey(shot: StoryboardShotStructureInput): string {
  return `${actKey(shot.actNumber)}:${String(shot.shotId || '')}`
}

function shotSceneKey(shot: StoryboardShotStructureInput): string {
  return normalizedId(shot.sceneId)
    || normalizedId(shot.locationId)
    || normalizedText(shot.sceneName)
    || normalizedText(shot.locationName)
}

function explicitUnitKey(shot: StoryboardShotStructureInput): string {
  return normalizedId(shot.generationUnitId) || normalizedId(shot.narrativeUnitId)
}

function actionChainKey(shot: StoryboardShotStructureInput): string {
  return normalizedId(shot.actionChainId)
}

function continuityKey(shot: StoryboardShotStructureInput): string {
  return normalizedId(shot.continuityGroupId) || normalizedId(shot.continuityId)
}

/**
 * Build contiguous, auditable generation-unit assignments.
 * Explicit U-unit IDs win. Legacy data falls back conservatively to contiguous
 * scene runs and never groups shots that have no structured scene evidence.
 */
export function buildShotProductionStructures(
  shots: StoryboardShotStructureInput[]
): ShotProductionStructure[] {
  let fallbackRun = 0
  let previousFallbackSignature: string | null = null

  return shots.map((shot) => {
    const act = actKey(shot.actNumber)
    const lookupKey = storyboardShotLookupKey(shot)
    const sceneKey = shotSceneKey(shot) || null
    const continuity = continuityKey(shot) || null
    const unit = explicitUnitKey(shot)
    if (unit) {
      previousFallbackSignature = null
      return {
        lookupKey,
        groupKey: `unit:${act}:${unit}`,
        source: 'explicit-unit' as const,
        sceneKey,
        continuityKey: continuity,
      }
    }

    const actionChain = actionChainKey(shot)
    if (actionChain) {
      previousFallbackSignature = null
      return {
        lookupKey,
        groupKey: `action:${act}:${actionChain}`,
        source: 'explicit-action-chain' as const,
        sceneKey,
        continuityKey: continuity,
      }
    }

    const forcedBoundary = shot.startsNewGenerationUnit === true
      || Boolean(normalizedText(shot.unitBoundaryReason))
    const fallbackSignature = sceneKey ? `${act}:${sceneKey}:${continuity || 'no-continuity-id'}` : null
    if (!fallbackSignature || forcedBoundary || fallbackSignature !== previousFallbackSignature) {
      fallbackRun += 1
    }
    previousFallbackSignature = fallbackSignature
    return {
      lookupKey,
      groupKey: fallbackSignature
        ? `scene-run:${fallbackRun}:${fallbackSignature}`
        : `isolated:${act}:${String(shot.shotId || fallbackRun)}`,
      source: fallbackSignature ? 'scene-fallback' as const : 'isolated' as const,
      sceneKey,
      continuityKey: continuity,
    }
  })
}

/** Decide whether the previous storyboard image is safe as a continuity reference. */
export function shouldUsePreviousShotContinuity(
  previous: StoryboardShotStructureInput | null | undefined,
  current: StoryboardShotStructureInput | null | undefined
): boolean {
  if (!previous || !current) return false
  if (current.continuityFromPrevious === false) return false

  const previousAct = actKey(previous.actNumber)
  const currentAct = actKey(current.actNumber)
  if (previousAct !== 'na' && currentAct !== 'na' && previousAct !== currentAct) return false

  const previousContinuity = continuityKey(previous)
  const currentContinuity = continuityKey(current)
  if (previousContinuity && currentContinuity) {
    return previousContinuity === currentContinuity
  }

  const previousScene = shotSceneKey(previous)
  const currentScene = shotSceneKey(current)
  if (!previousScene || !currentScene || previousScene !== currentScene) return false

  const previousTime = normalizedText(previous.timeOfDay)
  const currentTime = normalizedText(current.timeOfDay)
  if (previousTime && currentTime && previousTime !== currentTime) return false

  return current.continuityFromPrevious === true || previousScene === currentScene
}
