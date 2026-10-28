import 'server-only'

import { getSignedFileUrl } from '@/lib/r2'

const FINAL_STATUSES = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'])

export function stepTypeFromAction(actionKey?: string | null, stepName?: string | null): string | null {
  if (stepName) return stepName.toUpperCase()
  const action = String(actionKey || '').toLowerCase()
  if (action.includes('video_direct')) return 'VIDEO_DIRECT'
  if (action.includes('storyboard')) return 'STORYBOARD'
  if (action.includes('keyframe')) return 'KEYFRAMES'
  if (action.includes('trailer')) return 'TRAILER'
  if (action.includes('concept')) return 'CONCEPT'
  if (action.includes('character')) return 'CHARACTER'
  if (action.includes('style')) return 'STYLE'
  if (action.includes('framework')) return 'FRAMEWORK'
  if (action.includes('idea')) return 'IDEATION'
  return null
}

function stageFor(operation: any) {
  const attempts = Array.isArray(operation.providerAttempts) ? operation.providerAttempts : []
  const lastAttempt = attempts[attempts.length - 1]
  const rawStatus = String(operation.status || 'SUBMITTED').toUpperCase()
  const stale = !FINAL_STATUSES.has(rawStatus)
    && Date.now() - new Date(operation.updatedAt || operation.startedAt).getTime() > 10 * 60 * 1000

  if (rawStatus === 'SUCCEEDED' || rawStatus === 'PARTIAL') {
    return { status: 'completed', stage: 'saved', message: rawStatus === 'PARTIAL' ? '部分结果已保存' : '结果已保存' }
  }
  if (rawStatus === 'FAILED') return { status: 'failed', stage: 'failed', message: operation.errorMessage || '生成失败' }
  if (rawStatus === 'CANCELLED') return { status: 'failed', stage: 'cancelled', message: '任务已取消' }
  if (stale) return { status: 'interrupted', stage: 'interrupted', message: '任务心跳已中断，可按原配置恢复或重试' }
  if (!lastAttempt) return { status: 'running', stage: 'submitted', message: '请求已入库，等待供应商调用' }
  if (lastAttempt.status === 'RUNNING') {
    return { status: 'running', stage: 'provider-request', message: `正在调用 ${lastAttempt.provider}${lastAttempt.model ? ` · ${lastAttempt.model}` : ''}` }
  }
  if (lastAttempt.externalTaskId && !FINAL_STATUSES.has(rawStatus)) {
    return { status: 'running', stage: 'provider-processing', message: `${lastAttempt.provider} 已受理，等待生成结果` }
  }
  if (lastAttempt.status === 'FAILED' && attempts.length > 1) {
    return { status: 'running', stage: 'retrying', message: `供应商调用失败，正在执行第 ${attempts.length} 次尝试` }
  }
  return { status: 'running', stage: 'processing', message: '供应商调用已返回，正在整理并保存结果' }
}

export async function serializeGenerationTask(operation: any) {
  const state = stageFor(operation)
  const results = await Promise.all((operation.results || []).slice(0, 6).map(async (result: any) => ({
    id: result.id,
    kind: result.kind,
    mimeType: result.mimeType,
    isMock: Boolean(result.isMock),
    url: result.externalUrl || (result.storageKey ? await getSignedFileUrl(result.storageKey, 3600).catch(() => null) : null),
  })))
  const metadata = operation.metadata && typeof operation.metadata === 'object' ? operation.metadata : {}
  return {
    id: operation.id,
    projectId: operation.projectId,
    workflowStepId: operation.workflowStepId,
    stepType: stepTypeFromAction(operation.actionKey, operation.stepName),
    actionKey: operation.actionKey,
    category: operation.category,
    rawStatus: operation.status,
    ...state,
    startedAt: operation.startedAt,
    updatedAt: operation.updatedAt,
    completedAt: operation.completedAt,
    durationMs: operation.durationMs,
    error: operation.errorMessage,
    requestSnapshot: metadata.requestSnapshot || null,
    attempts: (operation.providerAttempts || []).map((attempt: any) => ({
      id: attempt.id,
      provider: attempt.provider,
      model: attempt.model,
      status: attempt.status,
      attemptNo: attempt.attemptNo,
      externalTaskId: attempt.externalTaskId,
      httpStatus: attempt.httpStatus,
      pollCount: attempt.pollCount,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      durationMs: attempt.durationMs,
      error: attempt.errorMessage,
    })),
    results,
  }
}

export const generationTaskInclude = {
  providerAttempts: { orderBy: { startedAt: 'asc' as const } },
  results: { orderBy: { createdAt: 'asc' as const } },
}

