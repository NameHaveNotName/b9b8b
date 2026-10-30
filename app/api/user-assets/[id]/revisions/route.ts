export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getSignedFileUrl } from '@/lib/r2'

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const asset = await prisma.userAsset.findFirst({
    where: { id, userId },
    include: { revisions: { orderBy: { revisionNumber: 'desc' }, include: { attachments: { orderBy: { position: 'asc' } } } } },
  })
  if (!asset) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  const revisions = await Promise.all(asset.revisions.map(async (revision) => ({
    ...revision,
    url: revision.storageKey ? await getSignedFileUrl(revision.storageKey).catch(() => null) : null,
    attachments: await Promise.all(revision.attachments.map(async (attachment) => ({ ...attachment, url: await getSignedFileUrl(attachment.storageKey).catch(() => null) }))),
  })))
  return NextResponse.json({ asset: { id: asset.id, title: asset.title, contentType: asset.contentType, currentRevisionId: asset.currentRevisionId }, revisions })
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const body = await req.json().catch(() => ({}))
  const revisionId = typeof body.revisionId === 'string' ? body.revisionId : ''
  const ownedAsset = await prisma.userAsset.findFirst({ where: { id, userId, deletedAt: null } })
  if (!ownedAsset) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  const revision = await prisma.userAssetRevision.findFirst({ where: { id: revisionId, userAssetId: id, ownerId: userId }, include: { attachments: { orderBy: { position: 'asc' } } } })
  if (!revision) return NextResponse.json({ error: 'REVISION_404' }, { status: 404 })
  const primary = revision.attachments.find((attachment) => attachment.role === 'PRIMARY') || revision.attachments[0]
  if (revision.contentType === 'IMAGE' && (!primary || !revision.mimeType || !revision.storageKey)) return NextResponse.json({ error: 'REVISION_MEDIA_404' }, { status: 409 })
  const storageKey = revision.storageKey || ownedAsset.storageKey
  const mimeType = revision.mimeType || ownedAsset.mimeType
  const url = revision.storageKey ? await getSignedFileUrl(revision.storageKey) : ownedAsset.url
  const asset = await prisma.userAsset.update({
    where: { id },
    data: { currentRevisionId: revision.id, contentType: revision.contentType, schemaVersion: revision.schemaVersion, structuredPayload: revision.structuredPayload ?? undefined, mimeType, storageKey, url, prompt: revision.promptSnapshot },
  })
  return NextResponse.json({ asset, revisionId: revision.id })
}
