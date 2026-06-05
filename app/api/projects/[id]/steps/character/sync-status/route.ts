export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { completeStep } from '@/lib/workflow-executor'

/**
 * 状态校准 API：查询资产库中角色图片数量，若与预期一致但步骤状态未同步，强制修正。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CHARACTER' } },
    include: { resultAssets: true },
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData as any) || {}
  const expectedCount = outputData.characterCount || outputData.prompts?.length || 0
  const actualCount = step.resultAssets?.length || 0

  let synced = false

  // 如果资产数量 >= 预期数量，但状态不是 COMPLETED，强制修正
  if (actualCount >= expectedCount && expectedCount > 0 && step.status !== 'COMPLETED') {
    try {
      await completeStep(step.id, {
        ...outputData,
        portraits: step.resultAssets.map((a: any) => ({
          character: {
            id: a.metadata?.characterId,
            name: a.metadata?.characterName,
          },
          assetId: a.id,
          url: a.url,
          llmPrompt: a.metadata?.llmPrompt,
        })),
        characterCount: actualCount,
        _syncedAt: new Date().toISOString(),
      })
      synced = true
      console.log(`[CHARACTER-SYNC] 强制同步成功: project=${params.id}, assets=${actualCount}/${expectedCount}`)
    } catch (e: any) {
      console.error(`[CHARACTER-SYNC] 强制同步失败:`, e.message)
      return NextResponse.json(
        { error: 'SYNC_FAILED', message: e.message, expectedCount, actualCount },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    success: true,
    synced,
    stepStatus: step.status,
    expectedCount,
    actualCount,
    assets: step.resultAssets.map((a: any) => ({
      id: a.id,
      url: a.url,
      characterId: a.metadata?.characterId,
      characterName: a.metadata?.characterName,
    })),
  })
}
