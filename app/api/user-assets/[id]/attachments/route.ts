export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { deleteFile, getSignedFileUrl, uploadFile } from '@/lib/r2'
import { hashAssetContent } from '@/lib/user-asset-revisions'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const asset = await prisma.userAsset.findFirst({
    where: { id, userId, deletedAt: null },
    include: { revisions: { orderBy: { revisionNumber: 'desc' }, take: 1, include: { attachments: { orderBy: { position: 'asc' } } } } },
  })
  if (!asset) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file || !ALLOWED_TYPES.has(file.type) || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'UPLOAD_INVALID' }, { status: 400 })
  const roleInput = typeof form?.get('role') === 'string' ? String(form?.get('role')).toUpperCase() : 'SUPPORTING'
  const role = ['PRIMARY', 'SUPPORTING', 'SIDE', 'DETAIL', 'STYLE'].includes(roleInput) ? roleInput : 'SUPPORTING'
  const buffer = Buffer.from(await file.arrayBuffer())
  const latest = asset.revisions[0]
  const storageKey = `users/${userId}/assets/${asset.id}/attachments/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  await uploadFile(storageKey, buffer, file.type)
  const hash = hashAssetContent(buffer)
  const topStorageKey = role === 'PRIMARY' ? storageKey : asset.storageKey
  const topMimeType = role === 'PRIMARY' ? file.type : asset.mimeType
  const url = await getSignedFileUrl(topStorageKey)
  let revision
  try {
    revision = await prisma.$transaction(async (tx) => {
    const created = await tx.userAssetRevision.create({
      data: {
        userAssetId: asset.id, ownerId: userId, revisionNumber: (latest?.revisionNumber || 0) + 1,
        contentType: asset.contentType, schemaVersion: asset.schemaVersion, structuredPayload: asset.structuredPayload ?? undefined,
        mimeType: role === 'PRIMARY' ? file.type : asset.mimeType,
        storageKey: role === 'PRIMARY' ? storageKey : asset.storageKey,
        promptSnapshot: asset.prompt, parentRevisionId: latest?.id,
        generationSnapshot: { action: 'ADD_ATTACHMENT', role, filename: file.name },
        attachments: { create: [
          ...(latest?.attachments || []).filter((attachment) => role !== 'PRIMARY' || attachment.role !== 'PRIMARY').map((attachment) => ({ role: attachment.role, position: attachment.position, mimeType: attachment.mimeType, storageKey: attachment.storageKey, contentHash: attachment.contentHash, metadata: attachment.metadata ?? undefined })),
          { role, position: role === 'PRIMARY' ? 0 : (latest?.attachments.length || 0), mimeType: file.type, storageKey, contentHash: hash },
        ] },
      },
    })
    await tx.userAsset.update({ where: { id: asset.id }, data: { currentRevisionId: created.id, storageKey: topStorageKey, mimeType: topMimeType, url } })
    return created
    })
  } catch (error) {
    await deleteFile(storageKey).catch(() => {})
    throw error
  }
  return NextResponse.json({ revision }, { status: 201 })
}
