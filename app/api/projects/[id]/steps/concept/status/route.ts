export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 轮询概念图生成进度。
 * 返回已生成的图片列表和 step 状态。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
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

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } },
    include: { resultAssets: true },
  })

  console.log('[CONCEPT-STATUS] projectId:', params.id, 'stepId:', step?.id, 'status:', step?.status, 'resultAssets:', step?.resultAssets?.length || 0)

  const assets = (step?.resultAssets || [])
    .filter((a) => (a.metadata as any)?.sceneIndex !== undefined)
    .sort((a, b) => ((a.metadata as any)?.sceneIndex || 0) - ((b.metadata as any)?.sceneIndex || 0))

  console.log('[CONCEPT-STATUS] filtered assets:', assets.length)

  const outputData = (step?.outputData as any) || {}
  const totalScenes = outputData.prompts?.length || assets.length || 0

  return NextResponse.json({
    status: step?.status || 'PENDING',
    assets,
    totalScenes,
    completedCount: assets.length,
  })
}
