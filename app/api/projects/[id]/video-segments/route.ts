export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { projectCoreSelect } from '@/lib/db/project-select'

/**
 * GET /api/projects/:id/video-segments?stepName=TRAILER
 *
 * 返回项目的所有 VideoSegment，用于前端轮询生成进度。
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: projectCoreSelect,
  })
  if (!project) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
  }

  const { searchParams } = new URL(req.url)
  const stepName = searchParams.get('stepName') || undefined

  let segments: any[] = []
  try {
    segments = await prisma.videoSegment.findMany({
      where: {
        projectId: params.id,
        ...(stepName ? { stepName } : {}),
      },
      orderBy: { sequence: 'asc' },
    })
  } catch (err: any) {
    if (err.code === 'P2021' || err?.cause?.message?.includes('does not exist')) {
      // VideoSegment 表尚未创建（迁移未执行），返回空数据
      return NextResponse.json({ segments: [], summary: { total: 0, pending: 0, generating: 0, completed: 0, failed: 0, allCompleted: false } })
    }
    throw err
  }

  let conceptImageMap = new Map<string, string>()
  if (stepName === 'TRAILER') {
    try {
      const conceptStep = await prisma.workflowStep.findUnique({
        where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } },
      })
      if (conceptStep) {
        const conceptAssets = await prisma.asset.findMany({
          where: { projectId: params.id, stepId: conceptStep.id, type: 'IMAGE' },
        })
        for (const asset of conceptAssets) {
          conceptImageMap.set(asset.id, asset.url)
        }
      }
    } catch (e: any) {
      console.warn('[VIDEO-SEGMENTS] 读取概念图失败:', e?.message)
    }
  }

  const segmentsWithImageUrl = segments.map((s) => ({
    ...s,
    imageUrl: stepName === 'TRAILER' ? conceptImageMap.get(s.shotId) || null : null,
  }))
  const allCompleted = segments.length > 0 && segments.every((s) => s.status === 'completed')
  const pendingCount = segments.filter((s) => s.status === 'pending').length
  const generatingCount = segments.filter((s) => s.status === 'generating').length
  const failedCount = segments.filter((s) => s.status === 'failed').length

  return NextResponse.json({
    segments: segmentsWithImageUrl,
    summary: {
      total: segments.length,
      pending: pendingCount,
      generating: generatingCount,
      completed: segments.filter((s) => s.status === 'completed').length,
      failed: failedCount,
      allCompleted,
    },
  })
}
