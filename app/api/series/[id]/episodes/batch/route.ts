export const dynamic = 'force-dynamic'

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { buildSeriesBibleConstraintPayload, sanitizeSeriesBible } from '@/lib/series'
import { batchEpisodeDraftHash, buildBatchEpisodeDrafts, sameIdSet, type BatchEpisodeDraft } from '@/lib/series-episode-batch'
import { buildInitialWorkflowSteps } from '@/lib/workflow-steps'
import { buildContinuityConstraintPayload, hasUsefulEpisodeContinuity, sanitizeEpisodeContinuity } from '@/lib/series-continuity'
import { applyPreparedSeriesAssets, prepareSeriesAssetsForProject } from '@/lib/series-assets'
import { deleteFile } from '@/lib/r2'
import { getSeriesAccess } from '@/lib/series-access'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id: seriesId } = await props.params
  const access = await getSeriesAccess(seriesId, user.id, 'EPISODE_CREATE')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const body = await req.json().catch(() => ({}))
  let drafts
  try {
    drafts = buildBatchEpisodeDrafts(body)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'VALIDATION_001', message: '起始集数、数量或标题模板不正确' }, { status: 400 })
  }

  const series = await prisma.storySeries.findFirst({
    where: { id: seriesId, status: 'ACTIVE' },
    include: {
      seasons: { where: { seasonNumber: 1 }, take: 1 },
      bibleRevisions: { orderBy: { revisionNumber: 'desc' }, take: 1 },
      assets: { where: { enabled: true }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!series) return NextResponse.json({ error: 'SERIES_404' }, { status: 404 })
  const season = series.seasons[0]
  const bibleRevision = series.bibleRevisions[0]
  if (!season || !bibleRevision) return NextResponse.json({ error: 'SERIES_INCOMPLETE', message: '系列缺少默认季或系列圣经' }, { status: 409 })

  const numbers = drafts.map((draft) => draft.episodeNumber)
  const conflicts = await prisma.storyEpisode.findMany({ where: { seasonId: season.id, episodeNumber: { in: numbers } }, select: { episodeNumber: true }, orderBy: { episodeNumber: 'asc' } })
  if (conflicts.length > 0) return NextResponse.json({ error: 'EPISODE_NUMBER_EXISTS', message: `第 ${conflicts.map((item) => item.episodeNumber).join('、')} 集已经存在`, conflicts: conflicts.map((item) => item.episodeNumber) }, { status: 409 })

  const seriesAssetIds = series.assets.map((asset) => asset.id)
  const draftHash = batchEpisodeDraftHash(drafts)
  const previousEpisode = await prisma.storyEpisode.findFirst({ where: { seasonId: season.id, episodeNumber: { lt: drafts[0].episodeNumber } }, orderBy: { episodeNumber: 'desc' }, select: { episodeNumber: true, continuityAfter: true } })
  const inheritedContinuity = sanitizeEpisodeContinuity(previousEpisode?.continuityAfter)
  const firstEpisodeCanInherit = Boolean(previousEpisode?.continuityAfter) && hasUsefulEpisodeContinuity(inheritedContinuity)

  if (body.action === 'preview') {
    return NextResponse.json({
      drafts,
      draftHash,
      bibleRevisionId: bibleRevision.id,
      bibleRevisionNumber: bibleRevision.revisionNumber,
      seriesAssetIds,
      seriesAssetCount: seriesAssetIds.length,
      inheritedFromEpisodeNumber: firstEpisodeCanInherit ? previousEpisode?.episodeNumber : null,
      continuityWarning: previousEpisode && !firstEpisodeCanInherit ? 'PREVIOUS_CONTINUITY_MISSING' : null,
    })
  }

  if (body.draftHash !== draftHash || body.expectedBibleRevisionId !== bibleRevision.id || !sameIdSet(body.expectedSeriesAssetIds, seriesAssetIds)) {
    return NextResponse.json({ error: 'BATCH_PREVIEW_STALE', message: '批量方案或系列版本已经变化，请重新预览' }, { status: 409 })
  }

  const plans = drafts.map((draft) => ({ draft, projectId: `project_${randomUUID().replaceAll('-', '')}` }))
  const copiedKeys: string[] = []
  try {
    const preparedPlans: Array<{
      draft: BatchEpisodeDraft
      projectId: string
      prepared: Awaited<ReturnType<typeof prepareSeriesAssetsForProject>>
    }> = []
    for (const plan of plans) {
      const prepared = await prepareSeriesAssetsForProject({ projectId: plan.projectId, assets: series.assets })
      copiedKeys.push(...prepared.copiedKeys)
      preparedPlans.push({ ...plan, prepared })
    }

    const result = await prisma.$transaction(async (tx) => {
      const [latestBible, currentAssets, racedEpisodes] = await Promise.all([
        tx.seriesBibleRevision.findFirst({ where: { seriesId }, orderBy: { revisionNumber: 'desc' }, select: { id: true } }),
        tx.seriesAsset.findMany({ where: { seriesId, enabled: true }, select: { id: true } }),
        tx.storyEpisode.findMany({ where: { seasonId: season.id, episodeNumber: { in: numbers } }, select: { episodeNumber: true } }),
      ])
      if (latestBible?.id !== body.expectedBibleRevisionId || !sameIdSet(body.expectedSeriesAssetIds, currentAssets.map((asset) => asset.id))) throw new Error('BATCH_PREVIEW_STALE')
      if (racedEpisodes.length > 0) throw new Error('EPISODE_NUMBER_EXISTS')

      const bible = sanitizeSeriesBible(bibleRevision.payload)
      const biblePayload = buildSeriesBibleConstraintPayload(series.title, bibleRevision.revisionNumber, bible)
      const created = []
      for (const plan of preparedPlans) {
        const prior = await tx.storyEpisode.findFirst({ where: { seasonId: season.id, episodeNumber: { lt: plan.draft.episodeNumber } }, orderBy: { episodeNumber: 'desc' }, select: { episodeNumber: true, continuityAfter: true } })
        const continuity = sanitizeEpisodeContinuity(prior?.continuityAfter)
        const hasContinuity = Boolean(prior?.continuityAfter) && hasUsefulEpisodeContinuity(continuity)
        const project = await tx.project.create({ data: { id: plan.projectId, userId: user.id, title: plan.draft.title, rawIdea: plan.draft.synopsis || plan.draft.title, status: 'ACTIVE' } })
        await tx.workflowStep.createMany({ data: buildInitialWorkflowSteps(project.id) })
        const bibleAsset = await tx.asset.create({ data: { projectId: project.id, createdById: user.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/vnd.ai-film-flow.series-bible+json', storageKey: `structured:series-bible:${bibleRevision.id}`, url: `structured:series-bible:${bibleRevision.id}`, structuredPayload: biblePayload, origin: 'SERIES_BIBLE_SNAPSHOT', metadata: { title: biblePayload.title, seriesId, bibleRevisionId: bibleRevision.id, revisionNumber: bibleRevision.revisionNumber } } })
        for (const targetStep of ['IDEATION', 'FRAMEWORK'] as const) await tx.projectAssetConstraint.create({ data: { projectId: project.id, assetId: bibleAsset.id, targetStep, interpretation: 'CONSTRAINTS', strength: 'HARD', scope: 'PROJECT', mergeStrategy: 'ADD', selectedFields: ['title', 'body'], payloadSnapshot: biblePayload, createdById: user.id } })
        if (hasContinuity && prior) {
          const continuityPayload = buildContinuityConstraintPayload(series.title, prior.episodeNumber, continuity)
          const continuityAsset = await tx.asset.create({ data: { projectId: project.id, createdById: user.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/vnd.ai-film-flow.series-continuity+json', storageKey: `structured:series-continuity:${season.id}:${prior.episodeNumber}`, url: `structured:series-continuity:${season.id}:${prior.episodeNumber}`, structuredPayload: continuityPayload, origin: 'SERIES_CONTINUITY_SNAPSHOT', metadata: { title: continuityPayload.title, seriesId, sourceEpisodeNumber: prior.episodeNumber } } })
          for (const targetStep of ['IDEATION', 'FRAMEWORK'] as const) await tx.projectAssetConstraint.create({ data: { projectId: project.id, assetId: continuityAsset.id, targetStep, interpretation: 'CONSTRAINTS', strength: 'HARD', scope: 'PROJECT', mergeStrategy: 'ADD', selectedFields: ['title', 'body'], payloadSnapshot: continuityPayload, createdById: user.id } })
        }
        const inherited = await applyPreparedSeriesAssets({ tx, projectId: project.id, actorId: user.id, prepared: plan.prepared.prepared })
        const episode = await tx.storyEpisode.create({ data: { seriesId, seasonId: season.id, projectId: project.id, bibleRevisionId: bibleRevision.id, episodeNumber: plan.draft.episodeNumber, title: plan.draft.title, synopsis: plan.draft.synopsis || null, continuityBefore: hasContinuity ? continuity : undefined } })
        created.push({ episodeId: episode.id, projectId: project.id, episodeNumber: episode.episodeNumber, inheritedSeriesAssetCount: inherited.importedCount, continuityWarning: prior && !hasContinuity ? 'PREVIOUS_CONTINUITY_MISSING' : null })
      }
      return created
    }, { maxWait: 10_000, timeout: 120_000 })
    return NextResponse.json({ created: result, count: result.length }, { status: 201 })
  } catch (error: any) {
    await Promise.all(copiedKeys.map((key) => deleteFile(key).catch(() => {})))
    if (error?.message === 'BATCH_PREVIEW_STALE') return NextResponse.json({ error: 'BATCH_PREVIEW_STALE', message: '系列版本已经变化，请重新预览' }, { status: 409 })
    if (error?.message === 'EPISODE_NUMBER_EXISTS' || error?.code === 'P2002') return NextResponse.json({ error: 'EPISODE_NUMBER_EXISTS', message: '部分集数已被占用，请重新预览' }, { status: 409 })
    console.error(`[POST /api/series/${seriesId}/episodes/batch]`, error)
    return NextResponse.json({ error: 'SERVER_001', message: '批量建集失败，未保留半成品' }, { status: 500 })
  }
}
