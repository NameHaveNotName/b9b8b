export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { ensureUserAssetsTable } from '@/lib/ensure-user-assets'
import { ensureAssetBindingsTable, resolveBindingUrl } from '@/lib/asset-bindings'

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
  const access = await checkProjectPermission(params.id)
  if (!access.allowed) return access.response
  await ensureUserAssetsTable()
  await ensureAssetBindingsTable()
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
  const access = await checkProjectPermission(params.id)
  if (!access.allowed) return access.response
  await ensureUserAssetsTable()
  await ensureAssetBindingsTable()

  const body = await req.json().catch(() => ({}))
  const targetType = typeof body.targetType === 'string' ? body.targetType.toUpperCase() : ''
  const targetKey = typeof body.targetKey === 'string' ? body.targetKey.trim() : ''
  const referenceRole = REFERENCE_ROLES.has(body.referenceRole) ? body.referenceRole : 'GENERAL'
  const userAssetId = typeof body.userAssetId === 'string' ? body.userAssetId : null
  const assetId = typeof body.assetId === 'string' ? body.assetId : null
  if (!TARGET_TYPES.has(targetType) || !targetKey || (!userAssetId && !assetId) || (userAssetId && assetId)) {
    return NextResponse.json({ error: 'VALIDATION_001', message: '绑定目标或资产来源无效' }, { status: 400 })
  }

  if (userAssetId) {
    const source = await prisma.userAsset.findFirst({ where: { id: userAssetId, ...(user.isAdmin ? {} : { userId: user.id }) } })
    if (!source) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  }
  if (assetId) {
    const source = await prisma.asset.findFirst({ where: { id: assetId, projectId: params.id } })
    if (!source) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  }

  const existing = await prisma.assetBinding.findFirst({
    where: { projectId: params.id, targetType, targetKey, userAssetId, assetId },
    include: { userAsset: true, asset: true },
  })
  if (existing) {
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
  const binding = await prisma.assetBinding.findUnique({ where: { id: created.id }, include: { userAsset: true, asset: true } })
  return NextResponse.json({ binding: await serialize(binding) }, { status: 201 })
}
