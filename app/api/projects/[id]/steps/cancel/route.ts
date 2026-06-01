export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { failStep } from '@/lib/workflow-executor'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { stepType } = body
  if (!stepType) {
    return NextResponse.json({ error: 'VALIDATION_001', message: '缺少 stepType' }, { status: 400 })
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

  await failStep(step.id, '[CANCELLED] 用户已取消')
  console.log(`[CANCEL] 用户 ${userId} 取消了步骤 ${stepType} (项目 ${params.id})`)

  return NextResponse.json({ success: true, message: '已取消' })
}
