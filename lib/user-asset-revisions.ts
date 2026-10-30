import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

export function hashAssetContent(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Create the compatibility UserAsset row and its immutable first revision atomically.
 * The top-level media fields remain populated while older callers are migrated.
 */
export async function createUserAssetWithInitialRevision(input: {
  data: Record<string, any>
  contentHash?: string | null
  generationSnapshot?: Record<string, any> | null
}) {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.userAsset.create({ data: input.data as any })
    const revision = await tx.userAssetRevision.create({
      data: {
        userAssetId: asset.id,
        ownerId: asset.userId,
        revisionNumber: 1,
        contentType: asset.contentType,
        schemaVersion: asset.schemaVersion,
        structuredPayload: asset.structuredPayload ?? undefined,
        mimeType: asset.mimeType,
        storageKey: asset.storageKey,
        contentHash: input.contentHash || undefined,
        promptSnapshot: asset.prompt || undefined,
        generationSnapshot: input.generationSnapshot || asset.metadata || undefined,
        attachments: asset.storageKey && asset.mimeType ? {
          create: {
            role: 'PRIMARY',
            position: 0,
            mimeType: asset.mimeType,
            storageKey: asset.storageKey,
            contentHash: input.contentHash || undefined,
          },
        } : undefined,
      },
    })
    return tx.userAsset.update({
      where: { id: asset.id },
      data: { currentRevisionId: revision.id },
    })
  })
}

export async function addUserAssetRevision(input: {
  userAssetId: string
  ownerId: string
  mimeType: string
  storageKey: string
  url: string
  prompt?: string | null
  contentHash?: string | null
  generationSnapshot?: Record<string, any> | null
  title?: string | null
  description?: string | null
  metadata?: Record<string, any> | null
}) {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.userAsset.findFirst({ where: { id: input.userAssetId, userId: input.ownerId, deletedAt: null } })
    if (!asset) throw new Error('ASSET_404')
    const latest = await tx.userAssetRevision.findFirst({ where: { userAssetId: asset.id }, orderBy: { revisionNumber: 'desc' } })
    const revision = await tx.userAssetRevision.create({
      data: {
        userAssetId: asset.id, ownerId: input.ownerId, revisionNumber: (latest?.revisionNumber || 0) + 1,
        contentType: asset.contentType, schemaVersion: asset.schemaVersion,
        structuredPayload: asset.structuredPayload ?? undefined, mimeType: input.mimeType,
        storageKey: input.storageKey, contentHash: input.contentHash || undefined,
        promptSnapshot: input.prompt || undefined, generationSnapshot: input.generationSnapshot || undefined,
        parentRevisionId: latest?.id,
        attachments: { create: { role: 'PRIMARY', position: 0, mimeType: input.mimeType, storageKey: input.storageKey, contentHash: input.contentHash || undefined } },
      },
    })
    const updated = await tx.userAsset.update({
      where: { id: asset.id },
      data: {
        currentRevisionId: revision.id, mimeType: input.mimeType, storageKey: input.storageKey,
        url: input.url, prompt: input.prompt, title: input.title || asset.title,
        description: input.description ?? asset.description,
        metadata: input.metadata ? { ...((asset.metadata as any) || {}), ...input.metadata } : undefined,
      },
    })
    return { asset: updated, revision }
  })
}
