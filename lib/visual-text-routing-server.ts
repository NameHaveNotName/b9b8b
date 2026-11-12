import { getAvailableOpenLuxModelIds } from './api-clients/openlux'
import {
  buildVisualTextRoutingSnapshot,
  modelForVisualStage,
  normalizeTextRoutingMode,
  type VisualTextRoutingSnapshot,
  type VisualTextStageId,
} from './text-model-routing'

export interface ResolvedVisualTextRoute {
  mode: ReturnType<typeof normalizeTextRoutingMode>
  legacyModel: string
  snapshot: VisualTextRoutingSnapshot | null
  model: string
}

export async function resolveVisualTextRoute(
  project: any,
  body: any,
  stageId: VisualTextStageId,
): Promise<ResolvedVisualTextRoute> {
  const framework = project?.framework || {}
  const mode = normalizeTextRoutingMode(body?.textRoutingMode || framework?.textRoutingMode)
  const legacyModel = body?.textModel || framework?.textModel || 'auto'
  const snapshot = mode === 'custom'
    ? null
    : buildVisualTextRoutingSnapshot(mode, await getAvailableOpenLuxModelIds())
  return { mode, legacyModel, snapshot, model: modelForVisualStage(snapshot, stageId, legacyModel) }
}
