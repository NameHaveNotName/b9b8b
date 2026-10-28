export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { deleteFile, getSignedFileUrl } from '@/lib/r2'
import { ensureUserAssetsTable } from '@/lib/ensure-user-assets'

const KINDS = new Set(['CHARACTER', 'ENVIRONMENT', 'STYLE', 'OBJECT', 'BRAND', 'REFERENCE'])

function validCandidateKey(userId: string, storageKey: unknown): storageKey is string {
  return typeof storageKey === 'string' && storageKey.startsWith(`users/${userId}/asset-candidates/`)
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  await ensureUserAssetsTable()
  const body = await req.json().catch(() => ({}))
  if (!validCandidateKey(userId, body.storageKey) || !KINDS.has(body.kind)) {
    return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  }
  const existing = await prisma.userAsset.findFirst({ where: { userId, storageKey: body.storageKey } })
  if (existing) return NextResponse.json({ asset: existing, duplicate: true })
  const url = await getSignedFileUrl(body.storageKey)
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag: unknown) => typeof tag === 'string').map((tag: string) => tag.trim()).filter(Boolean).slice(0, 20)
    : []
  const asset = await prisma.userAsset.create({
    data: {
      userId,
      kind: body.kind,
      source: 'GENERATED',
      title: typeof body.title === 'string' ? body.title.trim() : '未命名资产',
      description: typeof body.description === 'string' ? body.description.trim() : null,
      prompt: typeof body.prompt === 'string' ? body.prompt : null,
      templateId: typeof body.templateId === 'string' ? body.templateId : null,
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'image/png',
      storageKey: body.storageKey,
      url,
      metadata: { ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}), tags },
    },
  })
  return NextResponse.json({ asset }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!validCandidateKey(userId, body.storageKey)) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  await deleteFile(body.storageKey).catch(() => {})
  return NextResponse.json({ success: true })
}
