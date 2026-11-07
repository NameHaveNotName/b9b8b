export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { WORKFLOW_STEP_TYPES } from '@/lib/workflow-steps'
import { prisma } from '@/lib/prisma'
import { refundPointsAndLog } from '@/lib/points'
import {
  buildScopedMediaCancellationWhere,
  buildScopedOperationCancellationWhere,
  buildScopedUnitCancellationWhere,
} from '@/lib/step-cancellation-scope'

/**
 * 退掉被取消步骤尚未产生成果的预扣点数。
 *
 * 只处理该步骤上「已预扣但未退款、且仍处于未终结状态」的 OperationLog：
 * - pointsRefunded = 0 保证不会与后台任务自己的退款重复
 * - 跳过已终结的 SUCCEEDED（后台任务已成功交付成果）
 * - 跳过 pointsCost <= 0（本来就没扣钱）
 */
async function refundCancelledOperation(
  stepId: string,
  fallbackUserId: string,
  projectId: string
): Promise<number> {
  const pending = await prisma.operationLog.findMany({
    // 同时绑定项目与步骤。历史账本缺少任一归属时宁可留给人工对账，
    // 也不能用 projectId 级查询误退其他职责步骤的费用。
    where: buildScopedOperationCancellationWhere(projectId, stepId),
    select: {
      id: true,
      userId: true,
      pointsCost: true,
      billingSource: true,
      billingGroupId: true,
    },
  })

  let total = 0
  for (const op of pending) {
    try {
      await refundPointsAndLog(op.userId || fallbackUserId, op.pointsCost, {
        projectId,
        workflowStepId: stepId,
        operationId: op.id,
        billingSource: (op.billingSource as 'USER' | 'GROUP') || 'USER',
        billingGroupId: op.billingGroupId ?? null,
        finalStatus: 'CANCELLED',
        errorMessage: '用户已取消生成，点数已退回',
      })
      total += op.pointsCost
    } catch (e: any) {
      // 单条退款失败不能吞掉：否则用户被扣了钱却不知道，需要人工对账
      console.error(`[CANCEL] 退款失败 operationId=${op.id}:`, e?.message)
    }
  }
  return total
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const body = await req.json().catch(() => ({}))
  const { stepType } = body
  if (!WORKFLOW_STEP_TYPES.includes(stepType)) {
    return NextResponse.json({ error: 'VALIDATION_001', message: 'stepType 无效' }, { status: 400 })
  }
  const permission = await checkProjectPermission(project.id, undefined, { mode: 'EDIT_STEP', stepType })
  if (!permission.allowed) {
    return permission.response
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  if (step.status !== 'PROCESSING') {
    return NextResponse.json({ error: 'WORKFLOW_005', message: '步骤未在执行中' }, { status: 400 })
  }

  // 条件更新做 CAS：只在步骤仍处于 PROCESSING 时才取消，
  // 避免与并发的生成完成流程互相覆盖
  const cancelled = await prisma.workflowStep.updateMany({
    where: { id: step.id, status: 'PROCESSING' },
    data: { status: 'FAILED', errorMessage: '[CANCELLED] 用户已取消' },
  })
  if (cancelled.count !== 1) {
    return NextResponse.json({ error: 'WORKFLOW_005', message: '步骤已不在执行中' }, { status: 400 })
  }

  // 释放卡在 generating 的片段/配音行：它们的心跳已停止，
  // 15 分钟后会被超时清理翻成 failed，但用户不该等这么久
  const mediaWhere = buildScopedMediaCancellationWhere(params.id, stepType)
  const unitWhere = buildScopedUnitCancellationWhere(params.id, stepType)
  let releasedSegments = 0
  let releasedVoiceovers = 0
  let releasedUnits = 0
  if (mediaWhere && unitWhere) {
    const [segments, voiceovers, units] = await Promise.all([
      prisma.videoSegment.updateMany({
        where: mediaWhere,
        data: { status: 'failed', errorMessage: '用户已取消' },
      }),
      prisma.voiceoverSegment.updateMany({
        where: mediaWhere,
        data: { status: 'failed', errorMessage: '用户已取消' },
      }),
      prisma.generationUnit.updateMany({
        where: unitWhere,
        data: { status: 'cancelled', errorMessage: '用户已取消' },
      }),
    ])
    releasedSegments = segments.count
    releasedVoiceovers = voiceovers.count
    releasedUnits = units.count
  }

  // 退回本次预扣但尚未产生成果的点数。
  // 用 refundPointsAndLog 而不是直接加余额：它会先 finalize 账本行，
  // 并且靠 pointsRefunded 条件更新保证后台任务重投时不会重复退款。
  const refunded = await refundCancelledOperation(step.id, userId, params.id)

  console.log(
    `[CANCEL] 用户 ${userId} 取消了步骤 ${stepType} (项目 ${params.id})，` +
    `释放片段 ${releasedSegments} 个 / 配音 ${releasedVoiceovers} 条 / 生成单元 ${releasedUnits} 个，退款 ${refunded} 点`
  )

  return NextResponse.json({
    success: true,
    message: '已取消',
    releasedSegments,
    releasedVoiceovers,
    releasedUnits,
    refundedPoints: refunded,
  })
}
