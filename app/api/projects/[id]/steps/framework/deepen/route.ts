export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'
import {
  deepenCharacters,
  deepenSynopsis,
  deepenActs,
  extractAndDeepenEnvironments,
  updateDeepeningStatus,
} from '@/lib/framework-deepen'

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
  const { type } = body // 'characters' | 'story' | 'environments'

  if (!type || !['characters', 'story', 'environments'].includes(type)) {
    return NextResponse.json({ error: 'VALID_001', message: 'type 必须是 characters/story/environments 之一' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
  })
  if (!step || step.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'WORKFLOW_004', message: '框架尚未完成' }, { status: 400 })
  }

  const framework = (step.outputData as any) || {}

  const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足' }, { status: 403 })
  }

  try {
    let nextFramework = { ...framework }

    switch (type) {
      case 'characters':
        // 清除旧的角色深化结果
        if (nextFramework.characters) {
          nextFramework = {
            ...nextFramework,
            characters: nextFramework.characters.map((c: any) => {
              const { deepened, ...rest } = c
              return rest
            }),
          }
        }
        nextFramework = await deepenCharacters(nextFramework, step.id)
        break

      case 'story':
        // 清除旧的故事梗概和幕结构深化结果
        nextFramework = {
          ...nextFramework,
          deepenedSynopsis: undefined,
          acts: (nextFramework.acts || []).map((a: any) => {
            const { deepenedContent, ...rest } = a
            return rest
          }),
        }
        nextFramework = await deepenSynopsis(nextFramework, step.id)
        nextFramework = await deepenActs(nextFramework, step.id)
        break

      case 'environments':
        // 清除旧的环境深化结果
        nextFramework = {
          ...nextFramework,
          environments: [],
          environmentsDeepened: [],
        }
        nextFramework = await extractAndDeepenEnvironments(nextFramework, step.id)
        break
    }

    // 标记全部完成（如果单个类型深化，也标记为完成）
    nextFramework = await updateDeepeningStatus(step.id, nextFramework, 'completed', {
      current: 1,
      total: 1,
      phase: '全部深化完成',
    })

    await prisma.$transaction([
      prisma.workflowStep.update({
        where: { id: step.id },
        data: { outputData: nextFramework },
      }),
      prisma.project.update({
        where: { id: params.id },
        data: { framework: nextFramework },
      }),
    ])

    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', {
      projectId: params.id,
      workflowStepId: step.id,
      success: true,
    })

    return NextResponse.json({ success: true, data: nextFramework })
  } catch (e: any) {
    console.error(`[FRAMEWORK-DEEPEN] ${type} 深化失败:`, e.message)
    try {
      await updateDeepeningStatus(step.id, framework, 'error', {
        current: 0,
        total: 1,
        phase: `深化失败: ${e.message}`,
      })
    } catch {}
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', {
      projectId: params.id,
      workflowStepId: step.id,
      success: false,
      errorMessage: e.message,
    })
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
