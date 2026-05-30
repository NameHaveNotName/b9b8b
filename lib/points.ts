import { prisma } from '@/lib/prisma'
import { getCurrentUserId } from '@/lib/auth-helpers'

// 重新导出常量，保持 API 路由的 backward compatibility
export { DEFAULT_GENERATE_COST, DEFAULT_REGENERATE_COST } from '@/lib/points-config'

export interface PointsCheckResult {
  ok: boolean
  userId: string
  currentPoints: number
  cost: number
}

/** 检查用户积分是否足够 */
export async function checkPoints(cost: number = DEFAULT_GENERATE_COST): Promise<PointsCheckResult> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return { ok: false, userId: '', currentPoints: 0, cost }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, isAdmin: true },
  })

  if (!user) {
    return { ok: false, userId, currentPoints: 0, cost }
  }

  // 管理员不扣积分
  if (user.isAdmin) {
    return { ok: true, userId, currentPoints: user.points, cost: 0 }
  }

  if (user.points < cost) {
    return { ok: false, userId, currentPoints: user.points, cost }
  }

  return { ok: true, userId, currentPoints: user.points, cost }
}

/** 扣除积分并创建 OperationLog */
export async function deductPointsAndLog(
  userId: string,
  cost: number,
  type: 'generate' | 'regenerate' | 'error',
  meta: {
    projectId?: string
    workflowStepId?: string
    assetId?: string
    success?: boolean
    errorMessage?: string
  } = {}
) {
  if (cost <= 0) {
    // 即使不扣积分，也记录操作日志
    await prisma.operationLog.create({
      data: {
        userId,
        type,
        pointsCost: 0,
        success: meta.success ?? true,
        projectId: meta.projectId,
        workflowStepId: meta.workflowStepId,
        assetId: meta.assetId,
        errorMessage: meta.errorMessage,
      },
    })
    return
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { points: { decrement: cost } },
    }),
    prisma.operationLog.create({
      data: {
        userId,
        type,
        pointsCost: cost,
        success: meta.success ?? true,
        projectId: meta.projectId,
        workflowStepId: meta.workflowStepId,
        assetId: meta.assetId,
        errorMessage: meta.errorMessage,
      },
    }),
  ])
}
