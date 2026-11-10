export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { resolveBindingUrl } from '@/lib/asset-bindings'
import { ensureProjectAssetSnapshot } from '@/lib/project-asset-snapshots'

const TARGET_TYPES = new Set(['PROJECT', 'STEP', 'CHARACTER', 'SCENE', 'SHOT', 'TASK'])
const REFERENCE_ROLES = new Set(['IDENTITY', 'ENVIRONMENT', 'STYLE', 'PRODUCT', 'COMPOSITION', 'GENERAL'])

async function serialize(binding: any) {
  const userAsset = Array.isArray(binding?.userAsset) ? binding.userAsset[0] : binding?.userAsset
  const asset = Array.isArray(binding?.asset) ? binding.asset[0] : binding?.asset
  return {
    id: binding.id,
    targetType: binding.targetType,
    targetKey: binding.targetKey,
    referenceRole: binding.referenceRole,
    priority: binding.priority,
    userAssetId: binding.userAssetId,
    assetId: binding.assetId,
    title: userAsset?.title || (asset?.metadata as any)?.title || '优先素材',
    url: await resolveBindingUrl(binding),
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const access = await checkProjectPermission(params.id, undefined, { mode: 'READ' })
  if (!access.allowed) return access.response
  const { searchParams } = new URL(req.url)
  const targetType = searchParams.get('targetType') || undefined
  const targetKey = searchParams.get('targetKey') || undefined
  const bindings = await prisma.assetBinding.findMany({
    where: { projectId: params.id, enabled: true, ...(targetType ? { targetType } : {}), ...(targetKey ? { targetKey } : {}) },
    orderBy: [{ targetType: 'asc' }, { targetKey: 'asc' }, { priority: 'asc' }],
    include: { userAsset: true, asset: true },
  })
  return NextResponse.json({ bindings: await Promise.all(bindings.map(serialize)) })
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const access = await checkProjectPermission(params.id, undefined, { mode: 'EDIT_STEP', stepType: 'STYLE' })
  if (!access.allowed) return access.response

  const body = await req.json().catch(() => ({}))
  const targetType = typeof body.targetType === 'string' ? body.targetType.toUpperCase() : ''
  const targetKey = typeof body.targetKey === 'string' ? body.targetKey.trim() : ''
  const referenceRole = REFERENCE_ROLES.has(body.referenceRole) ? body.referenceRole : 'GENERAL'
  const requestedUserAssetId = typeof body.userAssetId === 'string' ? body.userAssetId : null
  let assetId = typeof body.assetId === 'string' ? body.assetId : null
  const userAssetId: string | null = null
  if (!TARGET_TYPES.has(targetType) || !targetKey || (!requestedUserAssetId && !assetId) || (requestedUserAssetId && assetId)) {
    return NextResponse.json({ error: 'VALIDATION_001', message: '绑定目标或资产来源无效' }, { status: 400 })
  }

  if (requestedUserAssetId) {
    try {
      const snapshot = await ensureProjectAssetSnapshot({ projectId: params.id, userAssetId: requestedUserAssetId, actorId: user.id })
      assetId = snapshot.asset.id
    } catch (error: any) {
      if (error?.message === 'ASSET_404') return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
      if (error?.message === 'ASSET_REVISION_404' || error?.message === 'ASSET_MEDIA_404') {
        return NextResponse.json({ error: error.message, message: '资产版本或媒体附件不存在' }, { status: 409 })
      }
      throw error
    }
  }
  if (assetId) {
    const source = await prisma.asset.findFirst({ where: { id: assetId, projectId: params.id } })
    if (!source) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  }

  // 一张身份参考只能属于一个角色；重新分配等同于移动，不能同时污染多个角色。
  if (assetId && targetType === 'CHARACTER' && referenceRole === 'IDENTITY') {
    await prisma.assetBinding.deleteMany({
      where: { projectId: params.id, assetId, targetType: 'CHARACTER', referenceRole: 'IDENTITY', targetKey: { not: targetKey } },
    })
  }

  const existing = await prisma.assetBinding.findFirst({
    where: { projectId: params.id, targetType, targetKey, userAssetId, assetId },
    include: { userAsset: true, asset: true },
  })
  if (existing) {
    if (assetId && targetType === 'CHARACTER' && referenceRole === 'IDENTITY') {
      const source = await prisma.asset.findUnique({ where: { id: assetId } })
      await prisma.asset.update({ where: { id: assetId }, data: { metadata: {
        ...((source?.metadata as any) || {}),
        referenceRole: 'IDENTITY',
        targetCharacterId: targetKey,
      } } })
    }
    const hydrated = await prisma.assetBinding.findUnique({ where: { id: existing.id }, include: { userAsset: true, asset: true } })
    return NextResponse.json({ binding: await serialize(hydrated || existing), duplicate: true })
  }

  const previousBindings = await prisma.assetBinding.findMany({ where: { projectId: params.id, targetType, targetKey } })
  await Promise.all(previousBindings.map((item) => prisma.assetBinding.update({
    where: { id: item.id },
    data: { priority: item.priority + 1 },
  })))
  const created = await prisma.assetBinding.create({
    data: {
      projectId: params.id,
      userAssetId,
      assetId,
      targetType,
      targetKey,
      referenceRole,
      priority: 0,
      createdById: user.id,
    },
  })
  if (assetId && targetType === 'CHARACTER' && referenceRole === 'IDENTITY') {
    const source = await prisma.asset.findUnique({ where: { id: assetId } })
    await prisma.asset.update({ where: { id: assetId }, data: { metadata: {
      ...((source?.metadata as any) || {}),
      referenceRole: 'IDENTITY',
      targetCharacterId: targetKey,
    } } })
  }
  const binding = await prisma.assetBinding.findUnique({ where: { id: created.id }, include: { userAsset: true, asset: true } })
  return NextResponse.json({ binding: await serialize(binding) }, { status: 201 })
}
