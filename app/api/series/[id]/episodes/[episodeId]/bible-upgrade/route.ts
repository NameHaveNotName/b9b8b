export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { buildSeriesBibleConstraintPayload, diffSeriesBible, sanitizeSeriesBible } from '@/lib/series'
import { getSeriesAccess } from '@/lib/series-access'

async function getUpgradeContext(seriesId: string, episodeId: string, userId: string) {
  const access = await getSeriesAccess(seriesId, userId, 'BIBLE_EDIT')
  if (!access.allowed) return null
  const series = await prisma.storySeries.findFirst({ where: { id: seriesId, status: 'ACTIVE' }, select: { id: true, title: true, currentBibleVersion: true } })
  if (!series) return null
  const episode = await prisma.storyEpisode.findFirst({ where: { id: episodeId, seriesId }, include: { bibleRevision: true } })
  if (!episode) return null
  const target = await prisma.seriesBibleRevision.findFirst({ where: { seriesId, revisionNumber: series.currentBibleVersion } })
  if (!target) return null
  return { series, episode, target }
}

export async function GET(_req: Request, props: { params: Promise<{ id: string; episodeId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, episodeId } = await props.params
  const context = await getUpgradeContext(id, episodeId, user.id)
  if (!context) return NextResponse.json({ error: 'EPISODE_404' }, { status: 404 })
  const completedSteps = await prisma.workflowStep.count({ where: { projectId: context.episode.projectId, status: 'COMPLETED' } })
  return NextResponse.json({
    upToDate: context.episode.bibleRevisionId === context.target.id,
    fromRevision: { id: context.episode.bibleRevision.id, revisionNumber: context.episode.bibleRevision.revisionNumber },
    toRevision: { id: context.target.id, revisionNumber: context.target.revisionNumber },
    changes: diffSeriesBible(context.episode.bibleRevision.payload, context.target.payload),
    completedSteps,
  })
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string; episodeId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, episodeId } = await props.params
  const body = await req.json().catch(() => ({}))
  if (body.confirm !== true || typeof body.fromRevisionId !== 'string' || typeof body.toRevisionId !== 'string') return NextResponse.json({ error: 'CONFIRM_REQUIRED' }, { status: 400 })
  const context = await getUpgradeContext(id, episodeId, user.id)
  if (!context) return NextResponse.json({ error: 'EPISODE_404' }, { status: 404 })
  if (context.episode.bibleRevisionId !== body.fromRevisionId || context.target.id !== body.toRevisionId) return NextResponse.json({ error: 'BIBLE_UPGRADE_STALE', message: '升级目标已变化，请重新预览' }, { status: 409 })
  if (context.episode.bibleRevisionId === context.target.id) return NextResponse.json({ error: 'BIBLE_ALREADY_CURRENT' }, { status: 409 })

  try {
    await prisma.$transaction(async (tx) => {
      const oldAsset = await tx.asset.findFirst({ where: { projectId: context.episode.projectId, origin: 'SERIES_BIBLE_SNAPSHOT', storageKey: `structured:series-bible:${context.episode.bibleRevisionId}` } })
      if (!oldAsset) throw new Error('BIBLE_SNAPSHOT_MISSING')
      const targetPayload = sanitizeSeriesBible(context.target.payload)
      const structuredPayload = buildSeriesBibleConstraintPayload(context.series.title, context.target.revisionNumber, targetPayload)
      const newAsset = await tx.asset.create({ data: { projectId: context.episode.projectId, createdById: user.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/vnd.ai-film-flow.series-bible+json', storageKey: `structured:series-bible:${context.target.id}`, url: `structured:series-bible:${context.target.id}`, structuredPayload, origin: 'SERIES_BIBLE_SNAPSHOT', metadata: { title: structuredPayload.title, seriesId: id, bibleRevisionId: context.target.id, revisionNumber: context.target.revisionNumber, upgradedFromRevisionId: context.episode.bibleRevisionId } } })
      await tx.projectAssetConstraint.updateMany({ where: { projectId: context.episode.projectId, assetId: oldAsset.id, enabled: true }, data: { enabled: false } })
      for (const targetStep of ['IDEATION', 'FRAMEWORK'] as const) await tx.projectAssetConstraint.create({ data: { projectId: context.episode.projectId, assetId: newAsset.id, targetStep, interpretation: 'CONSTRAINTS', strength: 'HARD', scope: 'PROJECT', mergeStrategy: 'ADD', selectedFields: ['title', 'body'], payloadSnapshot: structuredPayload, createdById: user.id } })
      const updated = await tx.storyEpisode.updateMany({ where: { id: episodeId, bibleRevisionId: context.episode.bibleRevisionId }, data: { bibleRevisionId: context.target.id } })
      if (updated.count !== 1) throw new Error('BIBLE_UPGRADE_STALE')
    })
    return NextResponse.json({ success: true, revisionNumber: context.target.revisionNumber })
  } catch (error: any) {
    if (error?.message === 'BIBLE_UPGRADE_STALE') return NextResponse.json({ error: 'BIBLE_UPGRADE_STALE', message: '单集版本已变化，请重新预览' }, { status: 409 })
    if (error?.message === 'BIBLE_SNAPSHOT_MISSING') return NextResponse.json({ error: 'BIBLE_SNAPSHOT_MISSING', message: '找不到本集原有圣经快照，未执行升级' }, { status: 409 })
    throw error
  }
}
