import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'
import { prisma } from '@/lib/prisma'

type OperationContext = { operationId: string; userId: string }

const globalStore = globalThis as typeof globalThis & {
  __supplierOperationContext?: AsyncLocalStorage<OperationContext>
}

const operationContext =
  globalStore.__supplierOperationContext || new AsyncLocalStorage<OperationContext>()
globalStore.__supplierOperationContext = operationContext

export type OperationCategory = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'MUSIC' | 'OTHER'

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
    },
  })
  enterOperationContext(operation.id, input.userId)
  return operation.id
}

export async function attachOperationResults(operationId: string, resultId?: string) {
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
            ? { kind: 'VIDEO', videoSegmentId: video.id, title: video.caption, storageKey: video.storageKey, mimeType: 'video/mp4', isMock: video.isMock }
            : voice
              ? { kind: 'AUDIO', voiceoverSegmentId: voice.id, title: voice.speaker, storageKey: voice.storageKey, mimeType: 'audio/mpeg' }
              : null
      if (result) {
        await prisma.operationResult.create({ data: { operationId, ...result } }).catch(() => undefined)
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
        await prisma.operationResult.create({
          data: {
            operationId,
            kind: asset.type,
            assetId: asset.id,
            storageKey: asset.storageKey,
            mimeType: asset.mimeType,
            metadata: asset.metadata === null ? undefined : asset.metadata,
          },
        }).catch(() => undefined)
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
      await attachOperationResults(operationId, input.resultId)
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
    await prisma.operationLog.update({
      where: { id: context.operationId },
      data: {
        status: 'RUNNING',
        category,
        actionKey: `generation.${category.toLowerCase()}`,
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
      try {
        const data = await response.clone().json()
        externalTaskId = findString(data, ['task_id', 'taskId', 'id'])
        errorCode = !response.ok ? findString(data, ['error_code', 'errorCode', 'code']) : undefined
      } catch {}
      await prisma.providerCallAttempt.update({
        where: { id: attemptId },
        data: {
          status: response.ok ? 'SUCCEEDED' : 'FAILED',
          httpStatus: response.status,
          requestId:
            response.headers.get('x-request-id') || response.headers.get('request-id') || undefined,
          externalTaskId,
          errorCode,
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
