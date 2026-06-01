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
  metadata?: Record<string, any>
}

/**
 * 写入操作日志到 OperationLog 表
 * 这是操作日志的单一写入入口，points.ts 中的 deductPointsAndLog 也会调用它
 */
export async function logOperation(input: LogOperationInput) {
  try {
    await prisma.operationLog.create({
      data: {
        userId: input.userId,
        type: input.actionType,
        projectId: input.projectId,
        workflowStepId: input.workflowStepId,
        assetId: input.assetId,
        pointsCost: input.cost ?? 0,
        success: input.status === 'success',
        errorMessage:
          input.status === 'failed' && input.metadata?.error
            ? String(input.metadata.error).slice(0, 500)
            : undefined,
      },
    })
  } catch (e: any) {
    // 日志写入失败不能阻断主流程，仅打印错误
    console.error('[logOperation] 写入失败:', e?.message, input)
  }
}
