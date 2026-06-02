export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    const iterations = await prisma.creativeIteration.findMany({
      where: { projectId: params.id },
      orderBy: { versionNumber: 'asc' },
      select: {
        id: true,
        versionNumber: true,
        creativeContent: true,
        retentionScore: true,
        qualityScore: true,
        concerns: true,
        improvementOptions: true,
        selectedImprovement: true,
        customFeedback: true,
        isCurrent: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ success: true, iterations })
  } catch (e: any) {
    console.error('[IDEATION-ITERATIONS] GET error:', e.message)
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message || '获取失败' },
      { status: 500 }
    )
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const { iterationId } = body

    if (!iterationId) {
      return NextResponse.json(
        { error: 'VALID_001', message: '缺少 iterationId' },
        { status: 400 }
      )
    }

    // 验证 iteration 存在且属于当前项目
    const iteration = await prisma.creativeIteration.findUnique({
      where: { id: iterationId },
    })
    if (!iteration || iteration.projectId !== params.id) {
      return NextResponse.json(
        { error: 'AUTH_002', message: '无权访问该迭代记录' },
        { status: 403 }
      )
    }

    // 将当前项目的所有 isCurrent 置为 false
    await prisma.creativeIteration.updateMany({
      where: { projectId: params.id, isCurrent: true },
      data: { isCurrent: false },
    })

    // 将目标 iteration 置为 isCurrent
    await prisma.creativeIteration.update({
      where: { id: iterationId },
      data: { isCurrent: true },
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[IDEATION-ITERATIONS] PATCH error:', e.message)
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message || '切换失败' },
      { status: 500 }
    )
  }
}
