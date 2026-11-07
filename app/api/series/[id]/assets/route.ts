export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { createSeriesAssetSnapshot, serializeSeriesAsset } from '@/lib/series-assets'
import { resolveOwnedUserAssetRevision } from '@/lib/project-asset-snapshots'
import { getSeriesAccess } from '@/lib/series-access'

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const access = await getSeriesAccess(id, user.id, 'READ')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const assets = await prisma.seriesAsset.findMany({ where: { seriesId: id, enabled: true }, orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ assets: await Promise.all(assets.map(serializeSeriesAsset)) })
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const access = await getSeriesAccess(id, user.id, 'ASSET_MANAGE')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const body = await req.json().catch(() => ({}))
  const userAssetId = typeof body.userAssetId === 'string' ? body.userAssetId : ''
  if (!userAssetId) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  try {
    if (body.action === 'preview') {
      const { revision } = await resolveOwnedUserAssetRevision({ userAssetId, actorId: user.id })
      const current = await prisma.seriesAsset.findFirst({ where: { seriesId: id, sourceUserAssetId: userAssetId, enabled: true } })
      const episodes = await prisma.storyEpisode.findMany({ where: { seriesId: id }, select: { projectId: true } })
      const inherited = current?.sourceUserAssetRevisionId && episodes.length > 0
        ? await prisma.asset.findMany({ where: { projectId: { in: episodes.map((episode) => episode.projectId) }, sourceUserAssetRevisionId: current.sourceUserAssetRevisionId, origin: 'SERIES_ASSET_SNAPSHOT' }, select: { projectId: true } })
        : []
      return NextResponse.json({ currentSeriesAssetId: current?.id || null, currentRevisionId: current?.sourceUserAssetRevisionId || null, targetRevisionId: revision.id, isUpdate: Boolean(current && current.sourceUserAssetRevisionId !== revision.id), affectedEpisodes: new Set(inherited.map((asset) => asset.projectId)).size })
    }
    const expectedCurrentSeriesAssetId = typeof body.expectedCurrentSeriesAssetId === 'string' ? body.expectedCurrentSeriesAssetId : ''
    if (expectedCurrentSeriesAssetId) {
      const current = await prisma.seriesAsset.findFirst({ where: { id: expectedCurrentSeriesAssetId, seriesId: id, sourceUserAssetId: userAssetId, enabled: true }, select: { id: true } })
      if (!current) return NextResponse.json({ error: 'SERIES_ASSET_STALE', message: '系列资产版本已经变化，请重新预览' }, { status: 409 })
    }
    const userAssetRevisionId = typeof body.targetRevisionId === 'string' ? body.targetRevisionId : undefined
    const result = await createSeriesAssetSnapshot({
      seriesId: id,
      userAssetId,
      actorId: user.id,
      userAssetRevisionId,
      expectedCurrentSeriesAssetId: expectedCurrentSeriesAssetId || undefined,
    })
    return NextResponse.json({ ...result, asset: await serializeSeriesAsset(result.asset) }, { status: result.duplicate ? 200 : 201 })
  } catch (error: any) {
    const conflictMessages: Record<string, string> = {
      SERIES_ASSET_STALE: '系列资产版本已经变化，请重新预览',
      SERIES_ASSET_PREVIEW_REQUIRED: '升级系列资产前需要先预览影响',
    }
    const status = error?.message === 'ASSET_404' ? 404 : ['ASSET_REVISION_404', 'ASSET_MEDIA_404', 'SERIES_ASSET_LIMIT', ...Object.keys(conflictMessages)].includes(error?.message) ? 409 : 500
    return NextResponse.json({ error: error?.message || 'SERIES_ASSET_COPY_FAILED', message: conflictMessages[error?.message] }, { status })
  }
}
