export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { episodeDetachmentFingerprint, isSeriesSnapshotOrigin } from '@/lib/series-detachment'

async function getContext(seriesId: string, episodeId: string, userId: string) {
  return prisma.storyEpisode.findFirst({
    where: { id: episodeId, seriesId, series: { userId, status: 'ACTIVE' } },
    include: {
      project: {
        select: {
          id: true,
          title: true,
          status: true,
          assets: { where: { deletedAt: null }, select: { id: true, origin: true } },
          assetConstraints: { select: { id: true, assetId: true, enabled: true } },
          steps: { select: { status: true } },
        },
      },
      bibleRevision: { select: { id: true, revisionNumber: true } },
      season: { select: { id: true } },
    },
  })
}

function state(context: NonNullable<Awaited<ReturnType<typeof getContext>>>) {
  const snapshots = context.project.assets.filter((asset) => isSeriesSnapshotOrigin(asset.origin))
  const snapshotIds = new Set(snapshots.map((asset) => asset.id))
  const constraints = context.project.assetConstraints.filter((constraint) => snapshotIds.has(constraint.assetId))
  return {
    snapshots,
    constraints,
    fingerprint: episodeDetachmentFingerprint({ episodeId: context.id, updatedAt: context.updatedAt, bibleRevisionId: context.bibleRevisionId, projectId: context.projectId, snapshotAssetIds: snapshots.map((asset) => asset.id), constraintIds: constraints.map((constraint) => constraint.id) }),
  }
}

export async function GET(_req: Request, props: { params: Promise<{ id: string; episodeId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, episodeId } = await props.params
  const context = await getContext(id, episodeId, user.id)
  if (!context) return NextResponse.json({ error: 'EPISODE_404' }, { status: 404 })
  const inventory = state(context)
  const nextEpisode = await prisma.storyEpisode.findFirst({ where: { seasonId: context.season.id, episodeNumber: { gt: context.episodeNumber } }, orderBy: { episodeNumber: 'asc' }, select: { episodeNumber: true, continuityBefore: true } })
  return NextResponse.json({
    fingerprint: inventory.fingerprint,
    episodeNumber: context.episodeNumber,
    title: context.title,
    projectId: context.projectId,
    projectTitle: context.project.title,
    bibleRevisionNumber: context.bibleRevision.revisionNumber,
    preservedSnapshotCount: inventory.snapshots.length,
    preservedConstraintCount: inventory.constraints.length,
    completedStepCount: context.project.steps.filter((step) => step.status === 'COMPLETED').length,
    nextEpisodeNumber: nextEpisode?.episodeNumber || null,
    nextEpisodeKeepsContinuitySnapshot: Boolean(nextEpisode?.continuityBefore),
  })
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string; episodeId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, episodeId } = await props.params
  const body = await req.json().catch(() => ({}))
  if (typeof body.fingerprint !== 'string') return NextResponse.json({ error: 'DETACH_PREVIEW_REQUIRED', message: '退出系列前需要先预览保留内容' }, { status: 409 })
  try {
    const result = await prisma.$transaction(async (tx) => {
      const context = await tx.storyEpisode.findFirst({
        where: { id: episodeId, seriesId: id, series: { userId: user.id, status: 'ACTIVE' } },
        include: { project: { select: { id: true, assets: { where: { deletedAt: null }, select: { id: true, origin: true } }, assetConstraints: { select: { id: true, assetId: true } } } }, bibleRevision: { select: { revisionNumber: true } } },
      })
      if (!context) throw new Error('EPISODE_404')
      const snapshots = context.project.assets.filter((asset) => isSeriesSnapshotOrigin(asset.origin))
      const snapshotIds = new Set(snapshots.map((asset) => asset.id))
      const constraints = context.project.assetConstraints.filter((constraint) => snapshotIds.has(constraint.assetId))
      const fingerprint = episodeDetachmentFingerprint({ episodeId: context.id, updatedAt: context.updatedAt, bibleRevisionId: context.bibleRevisionId, projectId: context.projectId, snapshotAssetIds: snapshots.map((asset) => asset.id), constraintIds: constraints.map((constraint) => constraint.id) })
      if (fingerprint !== body.fingerprint) throw new Error('DETACH_PREVIEW_STALE')
      await tx.asset.create({ data: { projectId: context.projectId, createdById: user.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/vnd.ai-film-flow.series-detachment+json', storageKey: `structured:series-detachment:${context.id}`, url: `structured:series-detachment:${context.id}`, origin: 'SERIES_DETACHMENT_RECORD', structuredPayload: { seriesId: id, formerEpisodeId: context.id, formerEpisodeNumber: context.episodeNumber, formerBibleRevisionId: context.bibleRevisionId, formerBibleRevisionNumber: context.bibleRevision.revisionNumber, preservedSnapshotAssetIds: snapshots.map((asset) => asset.id), preservedConstraintIds: constraints.map((constraint) => constraint.id), detachedAt: new Date().toISOString() }, metadata: { title: `原第 ${context.episodeNumber} 集退出系列记录`, immutableAudit: true } } })
      await tx.storyEpisode.delete({ where: { id: context.id } })
      return { projectId: context.projectId, preservedSnapshotCount: snapshots.length, preservedConstraintCount: constraints.length }
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    if (error?.message === 'EPISODE_404') return NextResponse.json({ error: 'EPISODE_404' }, { status: 404 })
    if (error?.message === 'DETACH_PREVIEW_STALE') return NextResponse.json({ error: 'DETACH_PREVIEW_STALE', message: '单集或快照已经变化，请重新预览' }, { status: 409 })
    console.error(`[DELETE /api/series/${id}/episodes/${episodeId}]`, error)
    return NextResponse.json({ error: 'SERVER_001', message: '退出系列失败' }, { status: 500 })
  }
}
