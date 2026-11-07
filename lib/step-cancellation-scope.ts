const MEDIA_STEP_NAMES = new Set(['TRAILER', 'VIDEO_DIRECT'])

export type CancellableMediaStepName = 'TRAILER' | 'VIDEO_DIRECT'

/**
 * 只有确实拥有独立视频/配音行的工作流步骤才允许释放媒体。
 * 其他步骤返回 null，取消步骤状态时不会退化成 projectId 级批量更新。
 */
export function getCancellableMediaStepName(stepType: string): CancellableMediaStepName | null {
  return MEDIA_STEP_NAMES.has(stepType) ? stepType as CancellableMediaStepName : null
}

export function buildScopedMediaCancellationWhere(projectId: string, stepType: string) {
  const stepName = getCancellableMediaStepName(stepType)
  if (!stepName) return null
  return { projectId, stepName, status: 'generating' as const }
}

export function buildScopedUnitCancellationWhere(projectId: string, stepType: string) {
  const stepName = getCancellableMediaStepName(stepType)
  if (!stepName) return null
  return {
    projectId,
    stepName,
    status: { in: ['queued', 'generating'] },
  }
}

export function buildScopedOperationCancellationWhere(
  projectId: string,
  workflowStepId: string,
) {
  return {
    projectId,
    workflowStepId,
    pointsRefunded: 0,
    pointsCost: { gt: 0 },
    status: { in: ['SUBMITTED', 'RUNNING'] },
  }
}
