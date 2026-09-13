import { prisma } from '@/lib/prisma'

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
  metadata?: Record<string, any>
}

/**
 * 写入操作日志到 OperationLog 表
 * 这是操作日志的单一写入入口，points.ts 中的 deductPointsAndLog 也会调用它
 */
export async function logOperation(input: LogOperationInput) {
  try {
    const completedAt = new Date()
    const data = {
        userId: input.userId,
        type: input.actionType,
        ...(input.actionKey || input.stepName
          ? { actionKey: input.actionKey || `generation.${input.stepName!.toLowerCase()}` }
          : input.operationId
            ? {}
            : { actionKey: `generation.${input.actionType}` }),
        category: input.category || 'OTHER',
        status: input.status === 'success' ? 'SUCCEEDED' : 'FAILED',
        projectId: input.projectId,
        workflowStepId: input.workflowStepId,
        stepName: input.stepName,
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
    if (input.operationId) {
      const existing = await prisma.operationLog.findUnique({
        where: { id: input.operationId },
        select: { startedAt: true },
      })
      await prisma.operationLog.update({
        where: { id: input.operationId },
        data: {
          ...data,
          durationMs: existing
            ? Math.max(0, completedAt.getTime() - existing.startedAt.getTime())
            : undefined,
        },
      })
      return input.operationId
    }
    const created = await prisma.operationLog.create({ data })
    return created.id
  } catch (e: any) {
    // 日志写入失败不能阻断主流程，仅打印错误
    console.error('[logOperation] 写入失败:', e?.message, input)
    return undefined
  }
}
