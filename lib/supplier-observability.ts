import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'

type OperationContext = { operationId: string; userId: string }

const globalStore = globalThis as typeof globalThis & {
  __supplierOperationContext?: AsyncLocalStorage<OperationContext>
}

const operationContext =
  globalStore.__supplierOperationContext || new AsyncLocalStorage<OperationContext>()
globalStore.__supplierOperationContext = operationContext

export type OperationCategory = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'MUSIC' | 'OTHER'

export type OperationTarget = {
  scopeType?: string
  scopeKey?: string
  targetType?: string
  targetKey?: string
  targetLabel?: string
  shotId?: string
  actNumber?: number
  adoptionStatus?: 'GENERATED' | 'ACTIVE' | 'ADOPTED' | 'REJECTED' | 'SUPERSEDED'
  adoptedById?: string
}

function safeMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 1000)
}

export function getCurrentOperationId() {
  return operationContext.getStore()?.operationId
}

export function enterOperationContext(operationId: string, userId: string) {
  operationContext.enterWith({ operationId, userId })
}

export async function beginSupplierOperation(input: {
  userId: string
  pointsCost: number
  billingSource?: string
  billingGroupId?: string | null
  projectId?: string
  actionKey?: string
  category?: OperationCategory
  idempotencyKey?: string
  scopeType?: string
  scopeKey?: string
}) {
  const operation = await prisma.operationLog.create({
    data: {
      userId: input.userId,
      type: 'generate',
      actionKey: input.actionKey || 'generation.unknown',
      category: input.category || 'OTHER',
      status: 'SUBMITTED',
      projectId: input.projectId,
      pointsCost: input.pointsCost,
      success: false,
      billingSource: input.billingSource || 'USER',
      billingGroupId: input.billingGroupId,
      idempotencyKey: input.idempotencyKey,
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
    },
  })
  enterOperationContext(operation.id, input.userId)
  return operation.id
}

export async function setCurrentOperationTarget(target: OperationTarget) {
  const operationId = getCurrentOperationId()
  if (!operationId) return
  await prisma.operationLog.update({
    where: { id: operationId },
    data: {
      scopeType: target.scopeType || target.targetType,
      scopeKey: target.scopeKey || target.targetKey,
    },
  }).catch((error) => console.error('[supplier-ledger] set target failed:', safeMessage(error)))
}

function normalizedResultTarget(metadata: unknown, target?: OperationTarget) {
  const record = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
  const shotId = target?.shotId || (typeof record.shotId === 'string' ? record.shotId : undefined)
  const styleId = typeof record.styleId === 'string' ? record.styleId : undefined
  const characterId = typeof record.characterId === 'string' ? record.characterId : undefined
  const rawActNumber = target?.actNumber ?? record.actNumber
  const actNumber = typeof rawActNumber === 'number' && Number.isFinite(rawActNumber)
    ? Math.trunc(rawActNumber)
    : undefined
  const inferredType = shotId ? 'SHOT' : styleId ? 'STYLE' : characterId ? 'CHARACTER' : undefined
  const inferredKey = shotId
    ? `act:${actNumber || 0}/shot:${shotId}`
    : styleId
      ? `style:${styleId}`
      : characterId
        ? `character:${characterId}`
        : undefined
  const targetType = target?.targetType || target?.scopeType || inferredType
  const targetKey = target?.targetKey || target?.scopeKey || inferredKey
  return {
    targetType,
    targetKey,
    targetLabel: target?.targetLabel,
    shotId,
    actNumber,
    adoptionStatus: target?.adoptionStatus,
    adoptedAt: target?.adoptionStatus === 'ACTIVE' || target?.adoptionStatus === 'ADOPTED' ? new Date() : undefined,
    adoptedById: target?.adoptedById,
  }
}

async function supersedePreviousResult(operationId: string, resultId: string, target: ReturnType<typeof normalizedResultTarget>) {
  if ((target.adoptionStatus !== 'ACTIVE' && target.adoptionStatus !== 'ADOPTED') || !target.targetType || !target.targetKey) return
  const operation = await prisma.operationLog.findUnique({ where: { id: operationId }, select: { projectId: true } })
  if (!operation?.projectId) return
  await prisma.operationResult.updateMany({
    where: {
      id: { not: resultId },
      operation: { projectId: operation.projectId },
      targetType: target.targetType,
      targetKey: target.targetKey,
      adoptionStatus: { in: ['ACTIVE', 'ADOPTED'] },
    },
    data: { adoptionStatus: 'SUPERSEDED' },
  })
}

export async function attachOperationResults(operationId: string, resultId?: string, target?: OperationTarget) {
  try {
    const operation = await prisma.operationLog.findUnique({
      where: { id: operationId },
      select: { projectId: true, workflowStepId: true, startedAt: true },
    })
    if (!operation) return

    if (resultId) {
      const [asset, userAsset, video, voice] = await Promise.all([
        prisma.asset.findUnique({ where: { id: resultId } }),
        prisma.userAsset.findUnique({ where: { id: resultId } }),
        prisma.videoSegment.findUnique({ where: { id: resultId } }),
        prisma.voiceoverSegment.findUnique({ where: { id: resultId } }),
      ])
      const result = asset
        ? { kind: asset.type, assetId: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType, metadata: asset.metadata === null ? undefined : asset.metadata }
        : userAsset
          ? { kind: userAsset.kind, userAssetId: userAsset.id, title: userAsset.title, storageKey: userAsset.storageKey, mimeType: userAsset.mimeType, metadata: userAsset.metadata === null ? undefined : userAsset.metadata }
          : video
            ? { kind: 'VIDEO', videoSegmentId: video.id, title: video.caption, storageKey: video.storageKey, mimeType: 'video/mp4', isMock: video.isMock, metadata: { shotId: video.shotId, actNumber: video.actNumber, stepName: video.stepName } }
            : voice
              ? { kind: 'AUDIO', voiceoverSegmentId: voice.id, title: voice.speaker, storageKey: voice.storageKey, mimeType: 'audio/mpeg' }
              : null
      if (result) {
        const normalizedTarget = normalizedResultTarget(result.metadata, target)
        const created = await prisma.operationResult.create({
          data: { operationId, ...result, ...normalizedTarget },
        }).catch(() => undefined)
        if (created) await supersedePreviousResult(operationId, created.id, normalizedTarget)
        return
      }
    }

    // Existing routes often return a workflow result without its Asset id. Associate
    // assets produced by the same step after this operation began.
    if (operation.workflowStepId) {
      const assets = await prisma.asset.findMany({
        where: {
          stepId: operation.workflowStepId,
          createdAt: { gte: operation.startedAt },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      })
      for (const asset of assets) {
        const normalizedTarget = normalizedResultTarget(asset.metadata, target)
        const created = await prisma.operationResult.create({
          data: {
            operationId,
            kind: asset.type,
            assetId: asset.id,
            storageKey: asset.storageKey,
            mimeType: asset.mimeType,
            metadata: asset.metadata === null ? undefined : asset.metadata,
            ...normalizedTarget,
          },
        }).catch(() => undefined)
        if (created) await supersedePreviousResult(operationId, created.id, normalizedTarget)
      }
    }
  } catch (error) {
    console.error('[supplier-ledger] attach results failed:', safeMessage(error))
  }
}

export async function finalizeCurrentSupplierOperation(input: {
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'
  projectId?: string
  workflowStepId?: string
  resultId?: string
  errorMessage?: string
  target?: OperationTarget
}) {
  const operationId = getCurrentOperationId()
  if (!operationId) return
  try {
    const operation = await prisma.operationLog.findUnique({
      where: { id: operationId },
      select: { startedAt: true },
    })
    if (!operation) return
    const completedAt = new Date()
    await prisma.operationLog.update({
      where: { id: operationId },
      data: {
        status: input.status,
        success: input.status === 'SUCCEEDED' || input.status === 'PARTIAL',
        projectId: input.projectId,
        workflowStepId: input.workflowStepId,
        errorMessage: input.errorMessage ? safeMessage(input.errorMessage) : undefined,
        completedAt,
        durationMs: Math.max(0, completedAt.getTime() - operation.startedAt.getTime()),
      },
    })
    if (input.status === 'SUCCEEDED' || input.status === 'PARTIAL') {
      await attachOperationResults(operationId, input.resultId, input.target)
    }
  } catch (error) {
    console.error('[supplier-ledger] finalize operation failed:', safeMessage(error))
  }
}

function inferProvider(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    if (host.includes('openlux.ai')) return 'OpenLux'
    if (host.includes('minimax')) return 'MiniMax'
    if (host.includes('dashscope.aliyuncs.com')) return 'DashScope'
  } catch {}
  return null
}

function inferCategory(endpoint: string, model?: string | null): OperationCategory {
  const value = `${endpoint} ${model || ''}`.toLowerCase()
  if (value.includes('music')) return 'MUSIC'
  if (value.includes('tts') || value.includes('speech') || value.includes('audio')) return 'AUDIO'
  if (value.includes('video')) return 'VIDEO'
  if (value.includes('image') || value.includes('img2')) return 'IMAGE'
  if (value.includes('chat') || value.includes('text') || value.includes('completion')) return 'TEXT'
  return 'OTHER'
}

function extractRequestModel(init?: RequestInit): string | undefined {
  if (typeof init?.body !== 'string') return undefined
  try {
    const body = JSON.parse(init.body)
    const model = body?.model || body?.model_name
    return typeof model === 'string' ? model.slice(0, 160) : undefined
  } catch {
    return undefined
  }
}

function findString(data: unknown, keys: string[]): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  for (const key of keys) {
    if (typeof record[key] === 'string') return String(record[key]).slice(0, 255)
  }
  for (const value of Object.values(record)) {
    const nested = findString(value, keys)
    if (nested) return nested
  }
  return undefined
}

function findNumber(data: unknown, keys: string[]): number | undefined {
  if (!data || typeof data !== 'object') return undefined
  const record = data as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return undefined
}

function extractUsage(data: unknown) {
  if (!data || typeof data !== 'object') return {}
  const root = data as Record<string, unknown>
  const usage = root.usage && typeof root.usage === 'object'
    ? root.usage as Record<string, unknown>
    : root.data && typeof root.data === 'object' && (root.data as Record<string, unknown>).usage
      ? (root.data as Record<string, unknown>).usage as Record<string, unknown>
      : undefined
  if (!usage) return {}
  const inputTokens = findNumber(usage, ['prompt_tokens', 'input_tokens'])
  const outputTokens = findNumber(usage, ['completion_tokens', 'output_tokens'])
  const totalTokens = findNumber(usage, ['total_tokens']) ??
    (inputTokens != null || outputTokens != null ? (inputTokens || 0) + (outputTokens || 0) : undefined)
  return { inputTokens, outputTokens, totalTokens }
}

/**
 * fetch-compatible supplier transport. It records request lifecycle metadata only;
 * request bodies, prompts, authorization headers and response payloads are never persisted.
 */
export async function trackedSupplierFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const rawUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const provider = inferProvider(rawUrl)
  const context = operationContext.getStore()
  if (!provider || !context) return fetch(input, init)

  const url = new URL(rawUrl)
  const endpoint = url.pathname.slice(0, 500)
  const model = extractRequestModel(init)
  const inputSummary = typeof init?.body === 'string'
    ? {
        sha256: createHash('sha256').update(init.body).digest('hex'),
        bytes: Buffer.byteLength(init.body),
      }
    : undefined
  const category = inferCategory(endpoint, model)
  const startedAt = new Date()
  let attemptId: string | undefined

  try {
    const count = await prisma.providerCallAttempt.count({
      where: { operationId: context.operationId },
    })
    const attempt = await prisma.providerCallAttempt.create({
      data: {
        operationId: context.operationId,
        provider,
        model,
        endpoint,
        method: init?.method || (input instanceof Request ? input.method : 'GET'),
        attemptNo: count + 1,
        status: 'RUNNING',
      },
    })
    attemptId = attempt.id
    const operation = await prisma.operationLog.findUnique({
      where: { id: context.operationId },
      select: { actionKey: true, category: true },
    })
    await prisma.operationLog.update({
      where: { id: context.operationId },
      data: {
        status: 'RUNNING',
        // A transport-level inference must never erase the more precise product
        // action recorded by checkPoints (for example keyframe vs concept art).
        ...(operation?.category === 'OTHER' ? { category } : {}),
        ...(operation?.actionKey === 'generation.unknown'
          ? { actionKey: `generation.${category.toLowerCase()}` }
          : {}),
        ...(inputSummary ? { inputSummary } : {}),
      },
    })
  } catch (error) {
    console.error('[supplier-ledger] start attempt failed:', safeMessage(error))
  }

  try {
    const response = await fetch(input, init)
    const completedAt = new Date()
    if (attemptId) {
      let externalTaskId: string | undefined
      let errorCode: string | undefined
      let usage: ReturnType<typeof extractUsage> = {}
      try {
        const data = await response.clone().json()
        externalTaskId = findString(data, ['task_id', 'taskId', 'id'])
        errorCode = !response.ok ? findString(data, ['error_code', 'errorCode', 'code']) : undefined
        usage = extractUsage(data)
      } catch {}
      await prisma.providerCallAttempt.update({
        where: { id: attemptId },
        data: {
          status: response.ok ? 'SUCCEEDED' : 'FAILED',
          httpStatus: response.status,
          requestId:
            response.headers.get('x-api-request-id') ||
            response.headers.get('x-request-id') ||
            response.headers.get('request-id') ||
            undefined,
          externalTaskId,
          errorCode,
          ...usage,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      }).catch((error) =>
        console.error('[supplier-ledger] finish attempt failed:', safeMessage(error)),
      )
    }
    return response
  } catch (error) {
    const completedAt = new Date()
    if (attemptId) {
      await prisma.providerCallAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'FAILED',
          errorMessage: safeMessage(error),
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      }).catch(() => undefined)
    }
    throw error
  }
}
