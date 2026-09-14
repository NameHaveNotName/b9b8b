import { prisma } from '@/lib/prisma'
import { getCurrentOperationId } from '@/lib/supplier-observability'

export type OperationActionType = 'generate' | 'regenerate' | 'skip' | 'error'
export type OperationStatus = 'success' | 'failed'

export interface LogOperationInput {
  userId: string
  projectId?: string
  workflowStepId?: string
  assetId?: string
  stepName?: string
  actionType: OperationActionType
  cost?: number
  status: OperationStatus
  billingSource?: 'USER' | 'GROUP'
  billingGroupId?: string | null
  balanceAfter?: number
  operationId?: string
  actionKey?: string
  category?: string
  scopeType?: string
  scopeKey?: string
  metadata?: Record<string, any>
}

/**
 * 写入操作日志到 OperationLog 表
 * 这是操作日志的单一写入入口，points.ts 中的 deductPointsAndLog 也会调用它
 */
export async function logOperation(input: LogOperationInput) {
  try {
    const operationId = input.operationId || getCurrentOperationId()
    const completedAt = new Date()

    // actionKey: 优先使用传入值 > stepName 推导 > 保留已有记录 > actionType 推导
    let actionKey: string | undefined
    if (input.actionKey) {
      actionKey = input.actionKey
    } else if (input.stepName) {
      actionKey = `generation.${input.stepName.toLowerCase()}`
    } else if (operationId) {
      // 更新已有记录时，不覆盖 actionKey（由 beginSupplierOperation 设置）
      actionKey = undefined
    } else {
      actionKey = `generation.${input.actionType}`
    }

    // category: 只有显式传入才覆盖，否则保留已有记录的值
    const category = input.category || (operationId ? undefined : 'OTHER')

    const data = {
        userId: input.userId,
        type: input.actionType,
        ...(actionKey !== undefined ? { actionKey } : {}),
        ...(category !== undefined ? { category } : {}),
        status: input.status === 'success' ? 'SUCCEEDED' : 'FAILED',
        projectId: input.projectId,
        workflowStepId: input.workflowStepId,
        stepName: input.stepName,
        scopeType: input.scopeType,
        scopeKey: input.scopeKey,
        assetId: input.assetId,
        pointsCost: input.cost ?? 0,
        success: input.status === 'success',
        billingSource: input.billingSource || 'USER',
        billingGroupId: input.billingGroupId,
        balanceAfter: input.balanceAfter,
        errorMessage:
          input.status === 'failed' && input.metadata?.error
            ? String(input.metadata.error).slice(0, 500)
            : undefined,
        completedAt,
      }
    if (operationId) {
      const existing = await prisma.operationLog.findUnique({
        where: { id: operationId },
        select: { startedAt: true },
      })
      await prisma.operationLog.update({
        where: { id: operationId },
        data: {
          ...data,
          durationMs: existing
            ? Math.max(0, completedAt.getTime() - existing.startedAt.getTime())
            : undefined,
        },
      })
      return operationId
    }
    const created = await prisma.operationLog.create({ data })
    return created.id
  } catch (e: any) {
    // 日志写入失败不能阻断主流程，仅打印错误
    console.error('[logOperation] 写入失败:', e?.message, input)
    return undefined
  }
}
