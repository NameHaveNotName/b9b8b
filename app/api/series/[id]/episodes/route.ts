export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { buildSeriesBibleConstraintPayload, normalizeEpisodeNumber, sanitizeSeriesBible } from '@/lib/series'
import { buildInitialWorkflowSteps } from '@/lib/workflow-steps'
import { buildContinuityConstraintPayload, hasUsefulEpisodeContinuity, sanitizeEpisodeContinuity } from '@/lib/series-continuity'
import { applyPreparedSeriesAssets, prepareSeriesAssetsForProject, retireExistingSeriesSnapshotUsages } from '@/lib/series-assets'
import { deleteFile } from '@/lib/r2'
import { getSeriesAccess } from '@/lib/series-access'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id: seriesId } = await props.params
  const access = await getSeriesAccess(seriesId, user.id, 'EPISODE_CREATE')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const body = await req.json().catch(() => ({}))
  const episodeNumber = normalizeEpisodeNumber(body.episodeNumber)
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  const synopsis = typeof body.synopsis === 'string' ? body.synopsis.trim().slice(0, 12_000) : ''
  const existingProjectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
  if (!episodeNumber || !title) return NextResponse.json({ error: 'VALIDATION_001', message: '集数和标题不能为空' }, { status: 400 })

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
  const duplicateEpisode = await prisma.storyEpisode.findFirst({ where: { seasonId: season.id, episodeNumber }, select: { id: true } })
  if (duplicateEpisode) return NextResponse.json({ error: 'EPISODE_NUMBER_EXISTS', message: '这一集编号已经存在' }, { status: 409 })

  if (existingProjectId) {
    const project = await prisma.project.findFirst({ where: { id: existingProjectId, userId: user.id, status: 'ACTIVE' } })
    if (!project) return NextResponse.json({ error: 'PROJECT_404' }, { status: 404 })
    const existingEpisode = await prisma.storyEpisode.findFirst({ where: { projectId: existingProjectId } })
    if (existingEpisode) return NextResponse.json({ error: 'PROJECT_ALREADY_IN_SERIES', message: '该项目已经属于一个系列集数' }, { status: 409 })
  }

  const copiedSeriesAssetKeys: string[] = []
  const plannedProjectId = existingProjectId || `project_${randomUUID().replaceAll('-', '')}`
  try {
    const preparedAssets = await prepareSeriesAssetsForProject({ projectId: plannedProjectId, assets: series.assets })
    copiedSeriesAssetKeys.push(...preparedAssets.copiedKeys)
    const result = await prisma.$transaction(async (tx) => {
      const previousEpisode = await tx.storyEpisode.findFirst({
        where: { seasonId: season.id, episodeNumber: { lt: episodeNumber } },
        orderBy: { episodeNumber: 'desc' },
        select: { episodeNumber: true, continuityAfter: true },
      })
      const inheritedContinuity = sanitizeEpisodeContinuity(previousEpisode?.continuityAfter)
      const hasInheritedContinuity = Boolean(previousEpisode?.continuityAfter) && hasUsefulEpisodeContinuity(inheritedContinuity)
      const project = existingProjectId
        ? await tx.project.findFirstOrThrow({ where: { id: existingProjectId, userId: user.id, status: 'ACTIVE' } })
        : await tx.project.create({ data: { id: plannedProjectId, userId: user.id, title, rawIdea: synopsis || title, status: 'ACTIVE' } })
      if (!existingProjectId) await tx.workflowStep.createMany({ data: buildInitialWorkflowSteps(project.id) })
      const retiredSeriesUsages = existingProjectId ? await retireExistingSeriesSnapshotUsages(tx, project.id) : { constraintCount: 0, bindingCount: 0 }

      const bible = sanitizeSeriesBible(bibleRevision.payload)
      const structuredPayload = buildSeriesBibleConstraintPayload(series.title, bibleRevision.revisionNumber, bible)
      const snapshotAsset = await tx.asset.create({
        data: {
          projectId: project.id,
          createdById: user.id,
          type: 'TEXT',
          contentType: 'TEXT',
          mimeType: 'application/vnd.ai-film-flow.series-bible+json',
          storageKey: `structured:series-bible:${bibleRevision.id}`,
          url: `structured:series-bible:${bibleRevision.id}`,
          structuredPayload,
          origin: 'SERIES_BIBLE_SNAPSHOT',
          metadata: { title: structuredPayload.title, seriesId, bibleRevisionId: bibleRevision.id, revisionNumber: bibleRevision.revisionNumber },
        },
      })
      for (const targetStep of ['IDEATION', 'FRAMEWORK'] as const) {
        await tx.projectAssetConstraint.create({
          data: {
            projectId: project.id,
            assetId: snapshotAsset.id,
            targetStep,
            interpretation: 'CONSTRAINTS',
            strength: 'HARD',
            scope: 'PROJECT',
            mergeStrategy: 'ADD',
            selectedFields: ['title', 'body'],
            payloadSnapshot: structuredPayload,
            createdById: user.id,
          },
        })
      }
      if (hasInheritedContinuity && previousEpisode) {
        const continuityPayload = buildContinuityConstraintPayload(series.title, previousEpisode.episodeNumber, inheritedContinuity)
        const continuityAsset = await tx.asset.create({
          data: {
            projectId: project.id,
            createdById: user.id,
            type: 'TEXT',
            contentType: 'TEXT',
            mimeType: 'application/vnd.ai-film-flow.series-continuity+json',
            storageKey: `structured:series-continuity:${season.id}:${previousEpisode.episodeNumber}`,
            url: `structured:series-continuity:${season.id}:${previousEpisode.episodeNumber}`,
            structuredPayload: continuityPayload,
            origin: 'SERIES_CONTINUITY_SNAPSHOT',
            metadata: { title: continuityPayload.title, seriesId, sourceEpisodeNumber: previousEpisode.episodeNumber },
          },
        })
        for (const targetStep of ['IDEATION', 'FRAMEWORK'] as const) {
          await tx.projectAssetConstraint.create({ data: { projectId: project.id, assetId: continuityAsset.id, targetStep, interpretation: 'CONSTRAINTS', strength: 'HARD', scope: 'PROJECT', mergeStrategy: 'ADD', selectedFields: ['title', 'body'], payloadSnapshot: continuityPayload, createdById: user.id } })
        }
      }
      const inheritedAssets = await applyPreparedSeriesAssets({ tx, projectId: project.id, actorId: user.id, prepared: preparedAssets.prepared })
      const episode = await tx.storyEpisode.create({
        data: {
          seriesId,
          seasonId: season.id,
          projectId: project.id,
          bibleRevisionId: bibleRevision.id,
          episodeNumber,
          title,
          synopsis: synopsis || null,
          continuityBefore: hasInheritedContinuity ? inheritedContinuity : undefined,
        },
      })
      return { episode, project, inheritedSeriesAssetCount: inheritedAssets.importedCount, retiredSeriesUsageCount: retiredSeriesUsages.constraintCount + retiredSeriesUsages.bindingCount, continuityWarning: previousEpisode && !hasInheritedContinuity ? 'PREVIOUS_CONTINUITY_MISSING' : null }
    }, { maxWait: 10_000, timeout: 60_000 })
    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    await Promise.all(copiedSeriesAssetKeys.map((key) => deleteFile(key).catch(() => {})))
    if (error?.code === 'P2002') return NextResponse.json({ error: 'EPISODE_NUMBER_EXISTS', message: '这一集编号已经存在' }, { status: 409 })
    console.error(`[POST /api/series/${seriesId}/episodes]`, error)
    return NextResponse.json({ error: 'SERVER_001', message: '创建单集失败' }, { status: 500 })
  }
}
