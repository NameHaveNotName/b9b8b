import { NextResponse } from 'next/server'
import { auth, isDemoMode, DEMO_USER } from '@/auth'
import { prisma } from '@/lib/prisma'
import { WORKFLOW_STEPS } from '@/lib/workflow'

const SKIPPABLE_STEPS = ['STYLE', 'CONCEPT', 'TRAILER', 'KEYFRAMES', 'REVIEW']

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  const isOwner = project?.userId === session.user.id
  const isDemoProject = isDemoMode && project?.userId === DEMO_USER.id
  if (!project || (!isOwner && !isDemoProject)) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const body = await _req.json().catch(() => ({}))
  const { stepType } = body

  if (!stepType || !SKIPPABLE_STEPS.includes(stepType)) {
    return NextResponse.json(
      { error: `该步骤不可跳过。可跳过的步骤: ${SKIPPABLE_STEPS.join(', ')}` },
      { status: 400 }
    )
  }

  const stepMeta = WORKFLOW_STEPS.find(s => s.type === stepType)
  if (!stepMeta) {
    return NextResponse.json({ error: '无效的步骤类型' }, { status: 400 })
  }

  // 查找或创建步骤记录
  let step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType } }
  })

  if (step) {
    step = await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'SKIPPED' as any, outputData: {} }
    })
  } else {
    step = await prisma.workflowStep.create({
      data: {
        projectId: params.id,
        stepType,
        status: 'SKIPPED' as any,
        order: stepMeta.order,
        outputData: {}
      }
    })
  }

  console.log(`[WORKFLOW-FIX] 跳过步骤 ${stepType} (项目 ${params.id})`)

  // 查找下一步
  const nextStep = WORKFLOW_STEPS.find(s => s.order === stepMeta.order + 1)
  const nextStepType = nextStep?.type ?? null

  return NextResponse.json({
    success: true,
    stepType,
    nextStepType,
    message: `已跳过 ${stepMeta.label}`,
  })
}
