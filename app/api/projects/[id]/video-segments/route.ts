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

  const segments = await prisma.videoSegment.findMany({
    where: {
      projectId: params.id,
      ...(stepName ? { stepName } : {}),
    },
    orderBy: { sequence: 'asc' },
  })

  const allCompleted = segments.length > 0 && segments.every((s) => s.status === 'completed')
  const pendingCount = segments.filter((s) => s.status === 'pending').length
  const generatingCount = segments.filter((s) => s.status === 'generating').length
  const failedCount = segments.filter((s) => s.status === 'failed').length

  return NextResponse.json({
    segments,
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
