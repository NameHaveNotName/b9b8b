import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { buildInitialWorkflowSteps } from '../lib/workflow-steps.ts'
import { buildSeriesBibleConstraintPayload, sanitizeSeriesBible } from '../lib/series.ts'
import { buildContinuityConstraintPayload, sanitizeEpisodeContinuity } from '../lib/series-continuity.ts'
import { buildBatchEpisodeDrafts } from '../lib/series-episode-batch.ts'

config({ path: '.env.local', quiet: true })
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString?.startsWith('postgresql://')) throw new Error('DATABASE_URL_MISSING')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const marker = `series-contract-${Date.now()}`

try {
  const owner = await prisma.user.findFirst({ select: { id: true } })
  if (!owner) {
    console.log('series database contract skipped: no user row')
    process.exit(0)
  }
  try {
    await prisma.$transaction(async (tx) => {
      const series = await tx.storySeries.create({ data: { userId: owner.id, title: marker } })
      const collaborator = await tx.user.create({ data: { email: `${marker}@example.invalid`, name: '契约协作者' } })
      const membership = await tx.seriesMembership.create({ data: { seriesId: series.id, userId: collaborator.id, role: 'EPISODE_EDITOR', assignedEpisodeIds: [] } })
      const season = await tx.storySeason.create({ data: { seriesId: series.id, seasonNumber: 1 } })
      const biblePayload = sanitizeSeriesBible({ premise: '契约测试', worldRules: ['不写入正式数据'] })
      const bible = await tx.seriesBibleRevision.create({ data: { seriesId: series.id, revisionNumber: 1, payload: biblePayload, createdById: owner.id } })
      const sharedAsset = await tx.seriesAsset.create({ data: { seriesId: series.id, createdById: owner.id, kind: 'CHARACTER', contentType: 'CHARACTER_CARD', title: '常驻角色', mimeType: 'application/json', storageKey: `series/${series.id}/contract.json`, structuredPayload: { name: '阿岚', role: '主角' } } })
      const project = await tx.project.create({ data: { userId: owner.id, title: marker, rawIdea: marker } })
      await tx.workflowStep.createMany({ data: buildInitialWorkflowSteps(project.id) })
      const structuredPayload = buildSeriesBibleConstraintPayload(marker, 1, biblePayload)
      const asset = await tx.asset.create({ data: { projectId: project.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/json', storageKey: `structured:series-bible:${bible.id}`, url: `structured:series-bible:${bible.id}`, structuredPayload, origin: 'SERIES_BIBLE_SNAPSHOT' } })
      const oldConstraint = await tx.projectAssetConstraint.create({ data: { projectId: project.id, assetId: asset.id, targetStep: 'IDEATION', payloadSnapshot: structuredPayload } })
      const ending = sanitizeEpisodeContinuity({ storyTime: '第一天夜里', openThreads: ['未拆开的信'] })
      const episode1 = await tx.storyEpisode.create({ data: { seriesId: series.id, seasonId: season.id, projectId: project.id, bibleRevisionId: bible.id, episodeNumber: 1, title: marker, continuityAfter: ending } })
      const biblePayload2 = sanitizeSeriesBible({ premise: '契约测试第二版', worldRules: ['不写入正式数据'] })
      const bible2 = await tx.seriesBibleRevision.create({ data: { seriesId: series.id, revisionNumber: 2, payload: biblePayload2, createdById: owner.id } })
      await tx.storySeries.update({ where: { id: series.id }, data: { currentBibleVersion: 2 } })
      const structuredPayload2 = buildSeriesBibleConstraintPayload(marker, 2, biblePayload2)
      const asset2 = await tx.asset.create({ data: { projectId: project.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/json', storageKey: `structured:series-bible:${bible2.id}`, url: `structured:series-bible:${bible2.id}`, structuredPayload: structuredPayload2, origin: 'SERIES_BIBLE_SNAPSHOT' } })
      await tx.projectAssetConstraint.update({ where: { id: oldConstraint.id }, data: { enabled: false } })
      await tx.projectAssetConstraint.create({ data: { projectId: project.id, assetId: asset2.id, targetStep: 'IDEATION', strength: 'HARD', payloadSnapshot: structuredPayload2 } })
      await tx.storyEpisode.update({ where: { id: episode1.id }, data: { bibleRevisionId: bible2.id } })
      const upgraded = await tx.storyEpisode.findUniqueOrThrow({ where: { id: episode1.id }, select: { bibleRevisionId: true } })
      if (upgraded.bibleRevisionId !== bible2.id) throw new Error('BIBLE_UPGRADE_FAILED')
      const project2 = await tx.project.create({ data: { userId: owner.id, title: `${marker}-2`, rawIdea: marker } })
      await tx.workflowStep.createMany({ data: buildInitialWorkflowSteps(project2.id) })
      const inheritedAsset = await tx.asset.create({ data: { projectId: project2.id, type: 'REFERENCE', contentType: sharedAsset.contentType, mimeType: sharedAsset.mimeType, storageKey: `projects/${project2.id}/series-snapshots/${sharedAsset.id}.json`, url: 'storage:contract', structuredPayload: sharedAsset.structuredPayload ?? undefined, origin: 'SERIES_ASSET_SNAPSHOT', metadata: { seriesAssetId: sharedAsset.id } } })
      await tx.projectAssetConstraint.create({ data: { projectId: project2.id, assetId: inheritedAsset.id, targetStep: 'FRAMEWORK', targetKey: `series:${sharedAsset.id}`, strength: 'HARD', payloadSnapshot: { name: '阿岚', role: '主角' } } })
      const continuityPayload = buildContinuityConstraintPayload(marker, 1, ending)
      const continuityAsset = await tx.asset.create({ data: { projectId: project2.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/json', storageKey: `structured:${marker}:continuity`, url: `structured:${marker}:continuity`, structuredPayload: continuityPayload, origin: 'SERIES_CONTINUITY_SNAPSHOT' } })
      await tx.projectAssetConstraint.create({ data: { projectId: project2.id, assetId: continuityAsset.id, targetStep: 'IDEATION', strength: 'HARD', payloadSnapshot: continuityPayload } })
      const episode2 = await tx.storyEpisode.create({ data: { seriesId: series.id, seasonId: season.id, projectId: project2.id, bibleRevisionId: bible2.id, episodeNumber: 2, title: `${marker}-2`, continuityBefore: ending } })
      await tx.seriesMembership.update({ where: { id: membership.id }, data: { assignedEpisodeIds: [episode2.id] } })
      const approval = await tx.seriesBatchApproval.create({ data: { seriesId: series.id, requestedById: collaborator.id, episodeIds: [episode2.id], requestedPoints: 120, purpose: '契约审批测试' } })
      const approved = await tx.seriesBatchApproval.updateMany({ where: { id: approval.id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: owner.id, decidedAt: new Date() } })
      if (approved.count !== 1) throw new Error('SERIES_APPROVAL_CONTRACT_FAILED')
      if ((episode2.continuityBefore as any)?.openThreads?.[0] !== '未拆开的信') throw new Error('CONTINUITY_SNAPSHOT_FAILED')
      const batchDrafts = buildBatchEpisodeDrafts({ startEpisodeNumber: 3, count: 2, titlePattern: `${marker}-{n}` })
      for (const draft of batchDrafts) {
        const batchProject = await tx.project.create({ data: { userId: owner.id, title: draft.title, rawIdea: draft.title } })
        await tx.workflowStep.createMany({ data: buildInitialWorkflowSteps(batchProject.id) })
        const batchBibleAsset = await tx.asset.create({ data: { projectId: batchProject.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/json', storageKey: `structured:series-bible:${bible2.id}:${draft.episodeNumber}`, url: `structured:series-bible:${bible2.id}:${draft.episodeNumber}`, structuredPayload: structuredPayload2, origin: 'SERIES_BIBLE_SNAPSHOT' } })
        await tx.projectAssetConstraint.create({ data: { projectId: batchProject.id, assetId: batchBibleAsset.id, targetStep: 'IDEATION', strength: 'HARD', payloadSnapshot: structuredPayload2 } })
        await tx.storyEpisode.create({ data: { seriesId: series.id, seasonId: season.id, projectId: batchProject.id, bibleRevisionId: bible2.id, episodeNumber: draft.episodeNumber, title: draft.title } })
      }
      const [episodeCount, workflowCount] = await Promise.all([
        tx.storyEpisode.count({ where: { seriesId: series.id } }),
        tx.workflowStep.count({ where: { project: { title: { startsWith: marker } } } }),
      ])
      if (episodeCount !== 4 || workflowCount !== 36) throw new Error('BATCH_EPISODE_CONTRACT_FAILED')
      await tx.asset.create({ data: { projectId: project2.id, type: 'TEXT', contentType: 'TEXT', mimeType: 'application/json', storageKey: `structured:series-detachment:${episode2.id}`, url: `structured:series-detachment:${episode2.id}`, structuredPayload: { formerEpisodeId: episode2.id }, origin: 'SERIES_DETACHMENT_RECORD' } })
      await tx.storyEpisode.delete({ where: { id: episode2.id } })
      const [preservedProject, preservedSnapshotCount, detachmentRecordCount] = await Promise.all([
        tx.project.findUnique({ where: { id: project2.id }, select: { id: true } }),
        tx.asset.count({ where: { projectId: project2.id, origin: { in: ['SERIES_ASSET_SNAPSHOT', 'SERIES_CONTINUITY_SNAPSHOT'] } } }),
        tx.asset.count({ where: { projectId: project2.id, origin: 'SERIES_DETACHMENT_RECORD' } }),
      ])
      if (!preservedProject || preservedSnapshotCount !== 2 || detachmentRecordCount !== 1) throw new Error('SERIES_DETACHMENT_PRESERVATION_FAILED')
      throw new Error('EXPECTED_ROLLBACK')
    }, { maxWait: 10_000, timeout: 30_000 })
  } catch (error: any) {
    if (error?.message !== 'EXPECTED_ROLLBACK') throw error
  }
  const residue = await prisma.storySeries.count({ where: { title: marker } })
  if (residue !== 0) throw new Error('SERIES_TRANSACTION_ROLLBACK_FAILED')
  console.log('series database transaction contract verified')
} finally {
  await prisma.$disconnect()
}
