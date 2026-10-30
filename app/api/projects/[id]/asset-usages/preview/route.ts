export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { selectConstraintPayload } from '@/lib/asset-constraints'

const TARGET_STEPS = new Set(['IDEATION', 'FRAMEWORK'])

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const access = await checkProjectPermission(projectId)
  if (!access.allowed) return access.response
  const body = await req.json().catch(() => ({}))
  const targetStep = typeof body.targetStep === 'string' ? body.targetStep.toUpperCase() : ''
  if (!TARGET_STEPS.has(targetStep)) return NextResponse.json({ error: 'TARGET_UNSUPPORTED' }, { status: 400 })

  const personal = typeof body.userAssetId === 'string'
    ? await prisma.userAsset.findFirst({ where: { id: body.userAssetId, userId: user.id, deletedAt: null } }) : null
  const projectAsset = typeof body.assetId === 'string'
    ? await prisma.asset.findFirst({ where: { id: body.assetId, projectId, deletedAt: null } }) : null
  const source = personal || projectAsset
  if (!source) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  const contentType = source.contentType
  const sourceTitle = personal?.title || ((projectAsset?.metadata as any)?.title as string | undefined) || null
  if (contentType === 'IMAGE' || !source.structuredPayload) {
    return NextResponse.json({ preview: { compatible: false, reason: '该落点需要结构化设定；图片请拖到角色或分镜参考图槽。' } })
  }
  const payload = selectConstraintPayload(contentType, source.structuredPayload, body.selectedFields)
  const fields = Object.keys(payload)
  const project = access.project as any
  const framework = project.framework && typeof project.framework === 'object' ? project.framework as any : {}
  const name = String((payload as any).name || (payload as any).title || sourceTitle || '')
  const existingNames = Array.isArray(framework.characters) ? framework.characters.map((character: any) => character?.name).filter(Boolean) : []
  const conflicts = targetStep === 'FRAMEWORK' && name && existingNames.includes(name) ? [`项目框架中已经存在同名角色“${name}”，应用时需选择合并或替换。`] : []
  return NextResponse.json({ preview: {
    compatible: true, title: sourceTitle || name || '未命名资产', contentType, fields, payload, conflicts,
    recommended: { strength: targetStep === 'IDEATION' ? 'SOFT' : 'HARD', scope: 'STEP', mergeStrategy: conflicts.length ? 'MERGE_SELECTED_FIELDS' : 'ADD' },
    effects: targetStep === 'IDEATION' ? ['影响创意方向、角色倾向或世界氛围', '默认只作用于创意扩散步骤'] : ['在框架搭建时新增或合并设定实体', '会进入本次实际提交给模型的约束快照'],
  } })
}
