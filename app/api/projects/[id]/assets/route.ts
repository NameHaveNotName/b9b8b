export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { resolveStorageReference, getSignedFileUrl } from '@/lib/r2'

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const permission = await checkProjectPermission(params.id, undefined, { mode: 'READ' })
  if (!permission.allowed) {
    return permission.response
  }
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') as
    | 'IMAGE'
    | 'VIDEO'
    | 'TEXT'
    | 'AUDIO'
    | 'REFERENCE'
    | null
  const page = Math.max(1, Number(searchParams.get('page') || '1'))
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || '20')))
  const origin = searchParams.get('origin')
  const skip = (page - 1) * limit

  const where: any = { projectId: params.id, deletedAt: null }
  if (type) {
    where.type = type
  }
  if (origin) where.origin = origin

  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        step: { select: { stepType: true } },
      },
    }),
    prisma.asset.count({ where }),
  ])

  const hydrated = await Promise.all(assets.map(async (asset: any) => {
    let url = await resolveStorageReference(asset.url).catch(() => asset.url)
    if ((!url || url === asset.url) && asset.storageKey && !String(asset.storageKey).startsWith('structured:')) {
      url = await getSignedFileUrl(asset.storageKey).catch(() => asset.url)
    }
    return { ...asset, url, step: Array.isArray(asset.step) ? asset.step[0] || null : asset.step }
  }))

  return NextResponse.json({
    assets: hydrated,
    total,
    page,
    limit,
    hasMore: skip + assets.length < total,
  })
}
