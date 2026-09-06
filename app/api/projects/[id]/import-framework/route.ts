export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { WorkflowStepType } from '@prisma/client'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
  }

  const body = await req.json().catch(() => ({}))
  const { framework, storyLength } = body

  if (!framework) {
    return NextResponse.json({ error: 'VALID_001', message: '缺少 framework 数据' }, { status: 400 })
  }

  try {
    // 1. 创建/更新 IDEATION 步骤（标记为完成，包含虚拟 direction）
    const ideationStep = await prisma.workflowStep.upsert({
      where: {
        projectId_stepType: {
          projectId: params.id,
          stepType: 'IDEATION',
        },
      },
      create: {
        projectId: params.id,
        stepType: 'IDEATION',
        status: 'COMPLETED',
        order: 0,
        outputData: {
          directions: [{
            title: '用户导入的故事',
            description: project.rawIdea?.slice(0, 200) + '...',
            keywords: ['用户故事', '导入'],
          }],
          storyLength: storyLength || 'medium',
          storyLengthLabel: '用户定义',
          projectTag: '',
        },
      },
      update: {
        status: 'COMPLETED',
        outputData: {
          directions: [{
            title: '用户导入的故事',
            description: project.rawIdea?.slice(0, 200) + '...',
            keywords: ['用户故事', '导入'],
          }],
          storyLength: storyLength || 'medium',
          storyLengthLabel: '用户定义',
          projectTag: '',
        },
        errorMessage: null,
      },
    })

    // 2. 创建/更新 FRAMEWORK 步骤（标记为完成）
    const frameworkStep = await prisma.workflowStep.upsert({
      where: {
        projectId_stepType: {
          projectId: params.id,
          stepType: 'FRAMEWORK',
        },
      },
      create: {
        projectId: params.id,
        stepType: 'FRAMEWORK',
        status: 'COMPLETED',
        order: 1,
        outputData: framework,
      },
      update: {
        status: 'COMPLETED',
        outputData: framework,
        errorMessage: null,
      },
    })

    // 3. 更新项目的 frameworkSource
    await prisma.project.update({
      where: { id: params.id },
      data: {
        frameworkSource: 'imported',
        selectedStyleId: null,
      },
    })

    // 4. 重置后续步骤（如果有的话）
    const subsequentSteps: WorkflowStepType[] = ['STYLE', 'CHARACTER', 'CONCEPT', 'STORYBOARD', 'TRAILER']
    await prisma.workflowStep.updateMany({
      where: {
        projectId: params.id,
        stepType: { in: subsequentSteps },
      },
      data: {
        status: 'PENDING',
        outputData: {},
        errorMessage: null,
      },
    })

    console.log('[IMPORT-FRAMEWORK] 成功导入框架，IDEATION 和 FRAMEWORK 已完成')

    return NextResponse.json({
      success: true,
      ideationStepId: ideationStep.id,
      frameworkStepId: frameworkStep.id,
    })
  } catch (e: any) {
    console.error('[IMPORT-FRAMEWORK] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
