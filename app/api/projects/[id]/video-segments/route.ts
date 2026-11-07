export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { projectCoreSelect } from '@/lib/db/project-select'
import { listRecoverableReferences } from '@/lib/video-reference-recovery'

/**
 * GET /api/projects/:id/video-segments?stepName=TRAILER
 *
 * 返回项目的所有 VideoSegment，用于前端轮询生成进度。
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: projectCoreSelect,
  })
  if (!project) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const permission = await checkProjectPermission(project.id, undefined, { mode: 'READ' })
  if (!permission.allowed) {
    return permission.response
  }

  const { searchParams } = new URL(req.url)
  const stepName = searchParams.get('stepName') || undefined

  let segments: any[] = []
  let timeline: any[] = []
  let activePlans: any[] = []
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
      return NextResponse.json({
        segments: [],
        timeline: [],
        productionPlans: [],
        summary: { total: 0, pending: 0, generating: 0, completed: 0, failed: 0, allCompleted: false },
      })
    }
    throw err
  }

  try {
    activePlans = await prisma.videoProductionPlan.findMany({
      where: {
        projectId: params.id,
        status: 'ACTIVE',
        ...(stepName ? { stepName } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })
    timeline = await prisma.timelineSegment.findMany({
      where: {
        projectId: params.id,
        ...(stepName ? { stepName } : {}),
        ...(activePlans.length
          ? { planId: { in: activePlans.map((plan) => plan.id) } }
          : { planId: null }),
      },
      include: {
        plan: true,
        generatedClip: true,
        generationUnit: {
          include: { items: { orderBy: { sequence: 'asc' } } },
        },
      },
      orderBy: [{ stepName: 'asc' }, { sequence: 'asc' }],
    })
  } catch (err: any) {
    if (err?.code !== 'P2021' && err?.code !== 'P2022' && !err?.cause?.message?.includes('does not exist')) {
      throw err
    }
    // 2.0 增量迁移尚未部署时继续提供旧版 segments，避免阻断现有工作流。
  }

  const conceptImageMap = new Map<string, string>()
  const recoveryBySegmentId = new Map<string, { generationUnitId: string; errorMessage: string; references: ReturnType<typeof listRecoverableReferences> }>()
  if (segments.length) {
    try {
      const unitItems = await prisma.generationUnitItem.findMany({
        where: { legacySegmentId: { in: segments.map((segment) => segment.id) } },
        include: { generationUnit: { select: { id: true, referenceAssets: true, errorMessage: true } } },
        orderBy: { createdAt: 'desc' },
      })
      for (const item of unitItems) {
        if (!item.legacySegmentId || recoveryBySegmentId.has(item.legacySegmentId)) continue
        const segment = segments.find((candidate) => candidate.id === item.legacySegmentId)
        const errorMessage = String(segment?.errorMessage || item.generationUnit.errorMessage || '')
        const references = listRecoverableReferences(item.generationUnit.referenceAssets, errorMessage)
        if (references.length) recoveryBySegmentId.set(item.legacySegmentId, {
          generationUnitId: item.generationUnit.id,
          errorMessage,
          references,
        })
      }
    } catch (err: any) {
      if (err?.code !== 'P2021' && err?.code !== 'P2022') throw err
    }
  }
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
    referenceRecovery: recoveryBySegmentId.get(s.id) || null,
  }))
  const allCompleted = segments.length > 0 && segments.every((s) => s.status === 'completed')
  const pendingCount = segments.filter((s) => s.status === 'pending').length
  const generatingCount = segments.filter((s) => s.status === 'generating').length
  const failedCount = segments.filter((s) => s.status === 'failed').length

  return NextResponse.json({
    segments: segmentsWithImageUrl,
    timeline,
    productionPlans: activePlans,
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
