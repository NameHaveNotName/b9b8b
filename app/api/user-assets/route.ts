export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import { ensureUserAssetsTable } from '@/lib/ensure-user-assets'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

function parseKind(value: unknown) {
  return value === 'CHARACTER' || value === 'ENVIRONMENT' || value === 'REFERENCE'
    ? value
    : 'REFERENCE'
}

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  await ensureUserAssetsTable()

  const { searchParams } = new URL(req.url)
  const kind = searchParams.get('kind')
  const where: any = { userId }
  if (kind === 'CHARACTER' || kind === 'ENVIRONMENT' || kind === 'REFERENCE') where.kind = kind

  const assets = await prisma.userAsset.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ assets })
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  await ensureUserAssetsTable()

  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })

  const kind = parseKind(formData.get('kind'))
  const title = typeof formData.get('title') === 'string' ? String(formData.get('title')).trim() : ''
  const description = typeof formData.get('description') === 'string' ? String(formData.get('description')).trim() : ''

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = file.name || 'asset.png'
  const storageKey = `users/${userId}/assets/${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  await uploadFile(storageKey, buffer, file.type)
  const url = await getSignedFileUrl(storageKey, 3600)

  const asset = await prisma.userAsset.create({
    data: {
      userId,
      kind,
      source: 'UPLOAD',
      title: title || filename,
      description,
      mimeType: file.type,
      storageKey,
      url,
      metadata: { originalFilename: filename },
    },
  })

  return NextResponse.json({ asset }, { status: 201 })
}
