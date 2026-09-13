import { prisma } from '@/lib/prisma'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { DEFAULT_GENERATE_COST, DEFAULT_REGENERATE_COST } from '@/lib/points-config'
import { logOperation } from '@/lib/operations'
import { selectBillingTarget, type BillingSource } from '@/lib/billing-policy'
import {
  attachOperationResults,
  beginSupplierOperation,
  getCurrentOperationId,
} from '@/lib/supplier-observability'

// 重新导出常量，保持 API 路由的 backward compatibility
export { DEFAULT_GENERATE_COST, DEFAULT_REGENERATE_COST }

export interface PointsCheckResult {
  ok: boolean
  userId: string
  currentPoints: number
  cost: number
  billingSource: BillingSource
  billingGroupId: string | null
}

interface BillingTarget {
  source: BillingSource
  groupId: string | null
  currentPoints: number
  cost: number
}

async function resolveBillingTarget(
  userId: string,
  cost: number,
  projectId?: string,
): Promise<BillingTarget | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, isAdmin: true },
  })

  if (!user) return null

  // 延续既有规则：系统管理员执行生成时不扣点。
  if (user.isAdmin) {
    return selectBillingTarget({ isAdmin: true, userPoints: user.points, cost })
  }

  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        group: { select: { id: true, points: true, costMode: true } },
      },
    })

    return selectBillingTarget({
      isAdmin: false,
      userPoints: user.points,
      cost,
      group: project?.group,
    })
  }

  return selectBillingTarget({ isAdmin: false, userPoints: user.points, cost })
}

/**
 * 检查生成操作的实际付款账户余额。
 * projectId 对应 GROUP_POOL 小组项目时检查小组池，否则检查执行用户。
 */
export async function checkPoints(
  cost: number = DEFAULT_GENERATE_COST,
  projectId?: string,
): Promise<PointsCheckResult> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      ok: false,
      userId: '',
      currentPoints: 0,
      cost,
      billingSource: 'USER',
      billingGroupId: null,
    }
  }

  const target = await resolveBillingTarget(userId, cost, projectId)
  if (!target) {
    return {
      ok: false,
      userId,
      currentPoints: 0,
      cost,
      billingSource: 'USER',
      billingGroupId: null,
    }
  }

  const ok = target.currentPoints >= target.cost
  if (ok) {
    try {
      await beginSupplierOperation({
        userId,
        pointsCost: target.cost,
        billingSource: target.source,
        billingGroupId: target.groupId,
        projectId,
      })
    } catch (error: any) {
      // Observability is fail-open: an unavailable ledger must not block generation.
      console.error('[supplier-ledger] begin operation failed:', error?.message)
    }
  }

  return {
    ok,
    userId,
    currentPoints: target.currentPoints,
    cost: target.cost,
    billingSource: target.source,
    billingGroupId: target.groupId,
  }
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
    billingSource?: BillingSource
    billingGroupId?: string | null
    stepName?: string
  } = {}
) {
  const resolved = await resolveBillingTarget(userId, cost, meta.projectId)
  const operationId = getCurrentOperationId()

  // 只有操作成功时才扣点；失败时只记录日志，不扣点
  if (cost <= 0 || meta.success === false) {
    await logOperation({
      userId,
      projectId: meta.projectId,
      workflowStepId: meta.workflowStepId,
      assetId: meta.assetId,
      actionType: type,
      cost: meta.success === false ? 0 : cost,
      status: meta.success === false ? 'failed' : 'success',
      billingSource: meta.billingSource || resolved?.source,
      billingGroupId: meta.billingGroupId ?? resolved?.groupId,
      operationId,
      stepName: meta.stepName,
      metadata: meta.errorMessage ? { error: meta.errorMessage } : undefined,
    })
    if (operationId && meta.success !== false) {
      await attachOperationResults(operationId, meta.assetId)
    }
    return
  }

  if (!resolved) throw new Error('POINTS_ACCOUNT_NOT_FOUND')

  // 检查与扣减在同一条条件更新中完成，避免多人并发把余额扣成负数。
  await prisma.$transaction(async (tx) => {
    let balanceAfter: number

    if (resolved.source === 'GROUP' && resolved.groupId) {
      const deduction = await tx.group.updateMany({
        where: { id: resolved.groupId, points: { gte: cost } },
        data: { points: { decrement: cost } },
      })
      if (deduction.count !== 1) throw new Error('POINTS_001: 小组点数不足')
      const group = await tx.group.findUniqueOrThrow({
        where: { id: resolved.groupId },
        select: { points: true },
      })
      balanceAfter = group.points
    } else {
      const deduction = await tx.user.updateMany({
        where: { id: userId, points: { gte: cost } },
        data: { points: { decrement: cost } },
      })
      if (deduction.count !== 1) throw new Error('POINTS_001: 个人点数不足')
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { points: true },
      })
      balanceAfter = user.points
    }

    const completedAt = new Date()
    const operationData = {
        userId,
        type,
        ...(meta.stepName
          ? { actionKey: `generation.${meta.stepName.toLowerCase()}` }
          : operationId
            ? {}
            : { actionKey: `generation.${type}` }),
        status: 'SUCCEEDED',
        projectId: meta.projectId,
        workflowStepId: meta.workflowStepId,
        stepName: meta.stepName,
        assetId: meta.assetId,
        pointsCost: cost,
        success: true,
        billingSource: resolved.source,
        billingGroupId: resolved.groupId,
        balanceAfter,
        completedAt,
      }
    if (operationId) {
      const existing = await tx.operationLog.findUnique({
        where: { id: operationId },
        select: { startedAt: true },
      })
      await tx.operationLog.update({
        where: { id: operationId },
        data: {
          ...operationData,
          durationMs: existing
            ? Math.max(0, completedAt.getTime() - existing.startedAt.getTime())
            : undefined,
        },
      })
    } else {
      await tx.operationLog.create({ data: operationData })
    }
  })
  if (operationId) await attachOperationResults(operationId, meta.assetId)
}

/**
 * 退回已预扣的点数。调用方必须传入预扣时确定的付款主体，避免任务执行期间
 * 小组切换扣费模式后把退款退到错误账户。
 */
export async function refundPointsAndLog(
  userId: string,
  cost: number,
  meta: {
    projectId?: string
    workflowStepId?: string
    billingSource: BillingSource
    billingGroupId: string | null
    errorMessage?: string
  },
) {
  if (cost <= 0) return

  await prisma.$transaction(async (tx) => {
    let balanceAfter: number

    if (meta.billingSource === 'GROUP' && meta.billingGroupId) {
      const group = await tx.group.update({
        where: { id: meta.billingGroupId },
        data: { points: { increment: cost } },
        select: { points: true },
      })
      balanceAfter = group.points
    } else {
      const user = await tx.user.update({
        where: { id: userId },
        data: { points: { increment: cost } },
        select: { points: true },
      })
      balanceAfter = user.points
    }

    await tx.operationLog.create({
      data: {
        userId,
        type: 'refund',
        projectId: meta.projectId,
        workflowStepId: meta.workflowStepId,
        pointsCost: -cost,
        success: true,
        errorMessage: meta.errorMessage?.slice(0, 500),
        billingSource: meta.billingSource,
        billingGroupId: meta.billingGroupId,
        balanceAfter,
      },
    })
  })
}
