import path from 'path'
import type { Prisma, SeriesAsset } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { copyFile, deleteFile, getSignedFileUrl, toStorageReference } from '@/lib/r2'
import { resolveOwnedUserAssetRevision } from '@/lib/project-asset-snapshots'
import { resolveUserAssetRevisionMedia } from '@/lib/user-asset-revision-policy'
import { hashAssetContent } from '@/lib/user-asset-revisions'
import { selectConstraintPayload } from '@/lib/structured-assets'
import { isStructuredSeriesAsset, MAX_SERIES_ASSETS, seriesReferenceRole } from '@/lib/series-asset-policy'

export async function createSeriesAssetSnapshot(input: {
  seriesId: string
  userAssetId: string
  actorId: string
  userAssetRevisionId?: string
  expectedCurrentSeriesAssetId?: string
}) {
  const { source, revision } = await resolveOwnedUserAssetRevision(input)
  const existing = await prisma.seriesAsset.findFirst({ where: { seriesId: input.seriesId, sourceUserAssetRevisionId: revision.id } })
  if (existing) {
    if (existing.enabled) return { asset: existing, duplicate: true, replacedCount: 0 }
    const restored = await prisma.$transaction(async (tx) => {
      const current = await tx.seriesAsset.findFirst({ where: { seriesId: input.seriesId, sourceUserAssetId: source.id, enabled: true }, select: { id: true } })
      if (current?.id !== input.expectedCurrentSeriesAssetId) {
        throw new Error(input.expectedCurrentSeriesAssetId ? 'SERIES_ASSET_STALE' : 'SERIES_ASSET_PREVIEW_REQUIRED')
      }
      const replaced = await tx.seriesAsset.updateMany({ where: { seriesId: input.seriesId, sourceUserAssetId: source.id, enabled: true }, data: { enabled: false } })
      const asset = await tx.seriesAsset.update({ where: { id: existing.id }, data: { enabled: true } })
      return { asset, replacedCount: replaced.count }
    })
    return { ...restored, duplicate: false }
  }
  const [count, previousSnapshot] = await Promise.all([
    prisma.seriesAsset.count({ where: { seriesId: input.seriesId, enabled: true } }),
    prisma.seriesAsset.findFirst({ where: { seriesId: input.seriesId, sourceUserAssetId: source.id, enabled: true } }),
  ])
  if (count >= MAX_SERIES_ASSETS && !previousSnapshot) throw new Error('SERIES_ASSET_LIMIT')
  const { sourceKey, mimeType } = resolveUserAssetRevisionMedia(source, revision)
  if (!sourceKey || !mimeType) throw new Error('ASSET_MEDIA_404')
  const extension = path.posix.extname(sourceKey) || (mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.bin')
  const destinationKey = `series/${input.seriesId}/assets/${source.id}/${revision.id}${extension}`
  const copied = await copyFile(sourceKey, destinationKey, mimeType)
  const contentHash = revision.contentHash || hashAssetContent(copied.buffer)
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.seriesAsset.findFirst({ where: { seriesId: input.seriesId, sourceUserAssetId: source.id, enabled: true }, select: { id: true } })
      if (current && current.id !== input.expectedCurrentSeriesAssetId) {
        throw new Error(input.expectedCurrentSeriesAssetId ? 'SERIES_ASSET_STALE' : 'SERIES_ASSET_PREVIEW_REQUIRED')
      }
      if (!current && input.expectedCurrentSeriesAssetId) throw new Error('SERIES_ASSET_STALE')
      const replaced = await tx.seriesAsset.updateMany({ where: { seriesId: input.seriesId, sourceUserAssetId: source.id, enabled: true }, data: { enabled: false } })
      const asset = await tx.seriesAsset.create({ data: { seriesId: input.seriesId, sourceUserAssetId: source.id, sourceUserAssetRevisionId: revision.id, createdById: input.actorId, kind: source.kind, contentType: revision.contentType, title: source.title || '未命名资产', description: source.description, mimeType, storageKey: destinationKey, schemaVersion: revision.schemaVersion, structuredPayload: revision.structuredPayload ?? undefined, contentHash } })
      return { asset, replacedCount: replaced.count }
    })
    return { ...result, duplicate: false }
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const raced = await prisma.seriesAsset.findFirst({ where: { seriesId: input.seriesId, sourceUserAssetRevisionId: revision.id } })
      if (raced) return { asset: raced, duplicate: true, replacedCount: 0 }
    }
    await deleteFile(destinationKey).catch(() => {})
    throw error
  }
}

export type PreparedSeriesAssetCopy = {
  source: SeriesAsset
  existingAssetId: string | null
  destinationKey: string | null
}

/** Object storage work runs before the DB transaction, so slow copies cannot expire it. */
export async function prepareSeriesAssetsForProject(input: {
  projectId: string
  assets: SeriesAsset[]
}) {
  const prepared: PreparedSeriesAssetCopy[] = []
  const copiedKeys: string[] = []
  try {
    for (const source of input.assets) {
      const extension = path.posix.extname(source.storageKey) || '.bin'
      const destinationKey = `projects/${input.projectId}/series-snapshots/${source.id}${extension}`
      const existing = await prisma.asset.findFirst({ where: { projectId: input.projectId, deletedAt: null, OR: [{ storageKey: destinationKey }, ...(source.sourceUserAssetRevisionId ? [{ sourceUserAssetRevisionId: source.sourceUserAssetRevisionId }] : [])] }, select: { id: true } })
      if (existing) {
        prepared.push({ source, existingAssetId: existing.id, destinationKey: null })
      } else {
        await copyFile(source.storageKey, destinationKey, source.mimeType)
        copiedKeys.push(destinationKey)
        prepared.push({ source, existingAssetId: null, destinationKey })
      }
    }
    return { prepared, copiedKeys }
  } catch (error) {
    await Promise.all(copiedKeys.map((key) => deleteFile(key).catch(() => {})))
    throw error
  }
}

export async function applyPreparedSeriesAssets(input: {
  tx: Prisma.TransactionClient
  projectId: string
  actorId: string
  prepared: PreparedSeriesAssetCopy[]
}) {
  let importedCount = 0
  for (const item of input.prepared) {
    const source = item.source
    let projectAsset = item.existingAssetId ? await input.tx.asset.findFirst({ where: { id: item.existingAssetId, projectId: input.projectId } }) : null
    if (!projectAsset) {
      if (!item.destinationKey) throw new Error('SERIES_ASSET_COPY_MISSING')
      projectAsset = await input.tx.asset.create({ data: { projectId: input.projectId, createdById: input.actorId, type: 'REFERENCE', contentType: source.contentType, mimeType: source.mimeType, storageKey: item.destinationKey, url: toStorageReference(item.destinationKey), schemaVersion: source.schemaVersion, structuredPayload: source.structuredPayload ?? undefined, sourceUserAssetId: source.sourceUserAssetId, sourceUserAssetRevisionId: source.sourceUserAssetRevisionId, contentHash: source.contentHash, origin: 'SERIES_ASSET_SNAPSHOT', metadata: { title: source.title, description: source.description, kind: source.kind, seriesAssetId: source.id, copiedAt: new Date().toISOString() } } })
    }
    if (isStructuredSeriesAsset(source.contentType, source.structuredPayload)) {
      const payloadSnapshot = selectConstraintPayload(source.contentType, source.structuredPayload)
      if (Object.keys(payloadSnapshot).length > 0) for (const targetStep of ['IDEATION', 'FRAMEWORK'] as const) await input.tx.projectAssetConstraint.upsert({ where: { projectId_assetId_targetStep_targetKey: { projectId: input.projectId, assetId: projectAsset.id, targetStep, targetKey: `series:${source.id}` } }, create: { projectId: input.projectId, assetId: projectAsset.id, targetStep, targetKey: `series:${source.id}`, interpretation: 'CONSTRAINTS', strength: 'HARD', scope: 'PROJECT', mergeStrategy: 'ADD', selectedFields: Object.keys(payloadSnapshot), payloadSnapshot: payloadSnapshot as any, createdById: input.actorId }, update: { enabled: true, payloadSnapshot: payloadSnapshot as any, selectedFields: Object.keys(payloadSnapshot), createdById: input.actorId } })
    } else {
      const binding = await input.tx.assetBinding.findFirst({ where: { projectId: input.projectId, assetId: projectAsset.id, targetType: 'PROJECT', targetKey: 'series-shared' } })
      if (!binding) await input.tx.assetBinding.create({ data: { projectId: input.projectId, assetId: projectAsset.id, targetType: 'PROJECT', targetKey: 'series-shared', referenceRole: seriesReferenceRole(source.kind), priority: importedCount, createdById: input.actorId, metadata: { seriesAssetId: source.id, inherited: true } } })
    }
    importedCount += 1
  }
  return { importedCount }
}

/** Rejoining a detached project must not keep two active series contexts. Records stay for audit. */
export async function retireExistingSeriesSnapshotUsages(tx: Prisma.TransactionClient, projectId: string) {
  const oldSnapshots = await tx.asset.findMany({
    where: { projectId, deletedAt: null, origin: { in: ['SERIES_BIBLE_SNAPSHOT', 'SERIES_CONTINUITY_SNAPSHOT', 'SERIES_ASSET_SNAPSHOT'] } },
    select: { id: true },
  })
  const assetIds = oldSnapshots.map((asset) => asset.id)
  if (assetIds.length === 0) return { constraintCount: 0, bindingCount: 0 }
  const [constraints, bindings] = await Promise.all([
    tx.projectAssetConstraint.updateMany({ where: { projectId, assetId: { in: assetIds }, enabled: true }, data: { enabled: false } }),
    tx.assetBinding.updateMany({ where: { projectId, assetId: { in: assetIds }, enabled: true }, data: { enabled: false } }),
  ])
  return { constraintCount: constraints.count, bindingCount: bindings.count }
}

export async function serializeSeriesAsset(asset: SeriesAsset) {
  return { ...asset, url: await getSignedFileUrl(asset.storageKey).catch(() => '') }
}
