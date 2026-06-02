export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { completeStep } from '@/lib/workflow-executor'

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { projectId, framework, frameworkSource = 'imported', fileName, fileUrl, rawText } = body

    if (!projectId || !framework) {
      return NextResponse.json(
        { error: 'VALID_001', message: '缺少 projectId 或 framework 数据' },
        { status: 400 }
      )
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    // 更新 Project 表
    await prisma.project.update({
      where: { id: projectId },
      data: {
        framework: framework as any,
        frameworkSource: frameworkSource === 'mixed' ? 'mixed' : 'imported',
        importedFileName: fileName || null,
        importedFileUrl: fileUrl || null,
        importedRawText: rawText || null,
        stepFrameworkDone: true,
      },
    })

    // 更新或创建 WorkflowStep
    let step = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
    })

    if (!step) {
      step = await prisma.workflowStep.create({
        data: {
          projectId,
          stepType: 'FRAMEWORK',
          status: 'COMPLETED',
          order: 1,
          outputData: framework as any,
          completedAt: new Date(),
        },
      })
    } else {
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: 'COMPLETED',
          outputData: framework as any,
          completedAt: new Date(),
          errorMessage: null,
        },
      })
    }

    console.log(`[FRAMEWORK-CONFIRM] 项目 ${projectId} 框架导入完成，来源: ${frameworkSource}`)

    return NextResponse.json({ success: true, stepId: step.id })
  } catch (e: any) {
    console.error('[FRAMEWORK-CONFIRM] POST error:', e)
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message || '确认导入失败' },
      { status: 500 }
    )
  }
}
