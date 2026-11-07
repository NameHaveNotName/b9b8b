import path from 'path'
import { prisma } from '@/lib/prisma'
import { copyFile, getSignedFileUrl, toStorageReference } from '@/lib/r2'
import { hashAssetContent } from '@/lib/user-asset-revisions'
import { resolveUserAssetRevisionMedia } from '@/lib/user-asset-revision-policy'

export async function resolveOwnedUserAssetRevision(input: {
  userAssetId: string
  actorId: string
  userAssetRevisionId?: string
}) {
  const source = await prisma.userAsset.findFirst({
    where: { id: input.userAssetId, userId: input.actorId, deletedAt: null },
  })
  if (!source) throw new Error('ASSET_404')

  const requestedRevisionId = input.userAssetRevisionId || source.currentRevisionId
  const revision = requestedRevisionId
    ? await prisma.userAssetRevision.findFirst({ where: { id: requestedRevisionId, userAssetId: source.id, ownerId: input.actorId }, include: { attachments: { orderBy: { position: 'asc' } } } })
    : await prisma.userAssetRevision.findFirst({ where: { userAssetId: source.id, ownerId: input.actorId }, orderBy: { revisionNumber: 'desc' }, include: { attachments: { orderBy: { position: 'asc' } } } })
  if (!revision) throw new Error('ASSET_REVISION_404')
  return { source, revision }
}

/** Copy a private library revision into project-owned storage before it can be bound. */
export async function ensureProjectAssetSnapshot(input: {
  projectId: string
  userAssetId: string
  actorId: string
  userAssetRevisionId?: string
}) {
  const { source, revision } = await resolveOwnedUserAssetRevision(input)
  const revisionId = revision.id

  const existing = await prisma.asset.findFirst({
    where: {
      projectId: input.projectId,
      sourceUserAssetRevisionId: revisionId,
      deletedAt: null,
    },
  })
  if (existing) return { asset: existing, duplicate: true }

  const { sourceKey, mimeType } = resolveUserAssetRevisionMedia(source, revision)
  if (!sourceKey || !mimeType) throw new Error('ASSET_MEDIA_404')

  const extension = path.posix.extname(sourceKey) || (mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png')
  const destinationKey = `projects/${input.projectId}/library-snapshots/${source.id}/${revisionId}${extension}`
  const copied = await copyFile(sourceKey, destinationKey, mimeType)
  const contentHash = revision.contentHash || hashAssetContent(copied.buffer)
  const metadata = {
    source: 'user-asset-library-snapshot',
    sourceUserAssetId: source.id,
    sourceUserAssetRevisionId: revisionId,
    kind: source.kind,
    title: source.title,
    description: source.description,
    copiedById: input.actorId,
    copiedAt: new Date().toISOString(),
  }

  try {
    const asset = await prisma.asset.create({
      data: {
        projectId: input.projectId,
        createdById: input.actorId,
        type: 'REFERENCE',
        contentType: revision.contentType,
        mimeType,
        storageKey: destinationKey,
        url: toStorageReference(destinationKey),
        schemaVersion: revision.schemaVersion,
        structuredPayload: revision.structuredPayload ?? undefined,
        sourceUserAssetId: source.id,
        sourceUserAssetRevisionId: revisionId,
        contentHash,
        origin: 'LIBRARY_SNAPSHOT',
        metadata,
      },
    })
    return { asset: { ...asset, url: await getSignedFileUrl(destinationKey) }, duplicate: false }
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const raced = await prisma.asset.findFirst({ where: { projectId: input.projectId, sourceUserAssetRevisionId: revisionId, deletedAt: null } })
      if (raced) return { asset: raced, duplicate: true }
    }
    throw error
  }
}
