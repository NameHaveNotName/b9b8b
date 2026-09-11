export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'

/**
 * 持久化分镜卡片的"最高优先级参考"（用户拖入的素材）。
 * POST { shotId, actNumber, refs: [{url, id?}] } → 写入 outputData.shotExtraRefs
 * DELETE { shotId } → 清除该 shot 的 extraRefs
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const access = await checkProjectPermission(params.id)
  if (!access.allowed) return access.response

  const body = await req.json().catch(() => ({}))
  const { shotId, actNumber, refs } = body
  if (!shotId || typeof shotId !== 'string') {
    return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } },
  })
  if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })

  const outputData = (step.outputData as any) || {}
  const shotExtraRefs: Record<string, Array<{ url: string; id?: string }>> = outputData.shotExtraRefs || {}
  const key = actNumber != null ? `${shotId}_${actNumber}` : shotId

  if (Array.isArray(refs)) {
    // 去重
    const cleaned = refs
      .filter((r: any) => r && typeof r.url === 'string')
      .map((r: any) => ({ url: r.url, id: r.id }))
    // 同一 url 不重复
    const seen = new Set<string>()
    const deduped = cleaned.filter((r: any) => {
      if (seen.has(r.url)) return false
      seen.add(r.url)
      return true
    })
    shotExtraRefs[key] = deduped
  } else {
    delete shotExtraRefs[key]
  }

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: { outputData: { ...outputData, shotExtraRefs } },
  })

  return NextResponse.json({ success: true, shotExtraRefs, key })
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const access = await checkProjectPermission(params.id)
  if (!access.allowed) return access.response

  const body = await req.json().catch(() => ({}))
  const { shotId, actNumber } = body
  if (!shotId) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } },
  })
  if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })

  const outputData = (step.outputData as any) || {}
  const shotExtraRefs: Record<string, Array<{ url: string; id?: string }>> = outputData.shotExtraRefs || {}
  const key = actNumber != null ? `${shotId}_${actNumber}` : shotId
  delete shotExtraRefs[key]

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: { outputData: { ...outputData, shotExtraRefs } },
  })

  return NextResponse.json({ success: true, shotExtraRefs, key })
}
