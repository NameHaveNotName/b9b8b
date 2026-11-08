import 'server-only'

import { getSignedFileUrl } from '@/lib/r2'
import { buildFrameworkDeepeningView } from '@/lib/framework-deepening-view'

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
  if (rawStatus === 'INTERRUPTED') return { status: 'interrupted', stage: 'interrupted', message: operation.errorMessage || '当前阶段执行中断，可从未完成阶段继续' }
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

export async function serializeGenerationTask(operation: any, workflowOutputData?: any) {
  let state = stageFor(operation)
  const frameworkDeepening = stepTypeFromAction(operation.actionKey, operation.stepName) === 'FRAMEWORK'
    ? buildFrameworkDeepeningView(workflowOutputData)
    : null
  if (frameworkDeepening && !['completed', 'error'].includes(frameworkDeepening.status)) {
    state = {
      status: 'running',
      stage: 'framework-deepening',
      message: `基础框架已保存；${frameworkDeepening.phase}。深化完成前不算整项结束`,
    }
  } else if (frameworkDeepening?.status === 'completed') {
    state = { status: 'completed', stage: 'saved', message: '基础框架与自动深化均已完成并保存' }
  } else if (frameworkDeepening?.status === 'error') {
    state = { status: 'failed', stage: 'framework-deepening-failed', message: `基础框架已保存，但${frameworkDeepening.phase}` }
  }
  const results = await Promise.all((operation.results || []).slice(0, 6).map(async (result: any) => ({
    id: result.id,
    kind: result.kind,
    mimeType: result.mimeType,
    isMock: Boolean(result.isMock),
    url: result.externalUrl || (result.storageKey ? await getSignedFileUrl(result.storageKey, 3600).catch(() => null) : null),
  })))
  const metadata = operation.metadata && typeof operation.metadata === 'object' ? operation.metadata : {}
  const pipelinePrefix = operation.projectId ? `ideation-pipeline:${operation.projectId}:` : ''
  const pipelineRunId = pipelinePrefix && typeof operation.idempotencyKey === 'string' && operation.idempotencyKey.startsWith(pipelinePrefix)
    ? operation.idempotencyKey.slice(pipelinePrefix.length)
    : null
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
    completedAt: state.status === 'running' ? null : operation.completedAt,
    durationMs: operation.durationMs,
    error: operation.errorMessage,
    pipelineRunId,
    requestSnapshot: metadata.requestSnapshot || null,
    frameworkDeepening,
    attempts: (operation.providerAttempts || []).map((attempt: any) => {
      const attemptMetadata = attempt.metadata && typeof attempt.metadata === 'object' ? attempt.metadata : {}
      return {
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
        stageId: typeof attemptMetadata.stageId === 'string' ? attemptMetadata.stageId : undefined,
        stageLabel: typeof attemptMetadata.stageLabel === 'string' ? attemptMetadata.stageLabel : undefined,
        outputAvailable: typeof attemptMetadata.outputAvailable === 'boolean' ? attemptMetadata.outputAvailable : undefined,
        outputText: typeof attemptMetadata.outputText === 'string' ? attemptMetadata.outputText : undefined,
      }
    }),
    results,
  }
}

export const generationTaskInclude = {
  providerAttempts: { orderBy: { startedAt: 'asc' as const } },
  results: { orderBy: { createdAt: 'asc' as const } },
}

