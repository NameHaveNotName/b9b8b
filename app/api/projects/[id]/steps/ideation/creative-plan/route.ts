export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { reviseCreativePlan } from '@/lib/creative-agent-pipeline'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const permission = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: 'IDEATION' })
  if (!permission.allowed) return permission.response

  const body = await req.json().catch(() => ({}))
  const feedback = typeof body?.feedback === 'string' ? body.feedback.trim() : ''
  if (feedback.length < 2 || feedback.length > 2000) {
    return NextResponse.json({ error: 'VALID_002', message: '修改意见需为 2—2000 个字' }, { status: 400 })
  }
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'IDEATION' } },
  })
  const output: any = step?.outputData || {}
  const run = output.agentRun
  if (!step || step.status !== 'COMPLETED' || !run?.artifacts?.creativePlan) {
    return NextResponse.json({ error: 'CREATIVE_PLAN_MISSING', message: '尚无可修改的完整创作方案' }, { status: 400 })
  }
  const pointsCheck = await checkPoints(GENERATION_COSTS.DEFAULT, projectId, 'generation.idea_plan_revision', 'TEXT')
  if (!pointsCheck.ok) return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })

  try {
    const textClient = await getTextClient()
    const revisedPlan = await reviseCreativePlan({
      currentPlan: run.artifacts.creativePlan,
      goalContract: run.artifacts.goalContract,
      userFeedback: feedback,
    }, prompt => textClient.generate(prompt, { maxTokens: 8192 }))
    const revision = {
      id: `creative-plan-revision-${Date.now()}`,
      label: '按用户意见修订',
      summary: typeof revisedPlan.summary === 'string' ? revisedPlan.summary.slice(0, 180) : '已按用户意见修订完整方案',
      status: 'completed',
      output: { feedback, before: run.artifacts.creativePlan, after: revisedPlan },
    }
    const nextRun = {
      ...run,
      status: 'AWAITING_CONFIRMATION',
      artifacts: { ...run.artifacts, creativePlan: revisedPlan },
      stages: [...(run.stages || []).filter((item: any) => item.id !== 'creative-plan-revision'), revision],
    }
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { outputData: { ...output, agentRun: nextRun, creativePlanConfirmed: false, creativePlanConfirmedAt: null } as any },
    })
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId, workflowStepId: step.id, success: true })
    return NextResponse.json({ success: true, data: { creativePlan: revisedPlan } })
  } catch (error: any) {
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId, workflowStepId: step.id, success: false, errorMessage: error?.message })
    return NextResponse.json({ error: 'API_001', message: error?.message || '方案修改失败' }, { status: 500 })
  }
}
