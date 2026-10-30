export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import { createUserAssetWithInitialRevision, hashAssetContent } from '@/lib/user-asset-revisions'
import { sanitizeStructuredPayload, structuredKind, STRUCTURED_CONTENT_TYPES } from '@/lib/structured-assets'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

function parseKind(value: unknown) {
  return value === 'CHARACTER' || value === 'ENVIRONMENT' || value === 'STYLE' || value === 'OBJECT' || value === 'BRAND' || value === 'REFERENCE'
    ? value
    : 'REFERENCE'
}

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const kind = searchParams.get('kind')
  const trash = searchParams.get('view') === 'trash'
  const where: any = { userId, deletedAt: trash ? { not: null } : null }
  if (['CHARACTER', 'ENVIRONMENT', 'STYLE', 'OBJECT', 'BRAND', 'STORY', 'TEXT', 'REFERENCE'].includes(kind || '')) where.kind = kind

  const assets = await prisma.userAsset.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const hydratedAssets = await Promise.all(assets.map(async (asset: any) => {
    try { return { ...asset, url: await getSignedFileUrl(asset.storageKey) } } catch { return asset }
  }))
  return NextResponse.json({ assets: hydratedAssets })
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  if (req.headers.get('content-type')?.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    const contentType = typeof body.contentType === 'string' ? body.contentType : ''
    if (!STRUCTURED_CONTENT_TYPES.has(contentType as any)) {
      return NextResponse.json({ error: 'VALIDATION_002', message: '不支持的结构化资产类型' }, { status: 400 })
    }
    try {
      const structuredPayload = sanitizeStructuredPayload(contentType, body.payload)
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : String((structuredPayload as any).name || (structuredPayload as any).title || '未命名设定')
      const serialized = Buffer.from(JSON.stringify({ schemaVersion: 1, contentType, payload: structuredPayload }, null, 2))
      const storageKey = `users/${userId}/assets/structured/${Date.now()}_${contentType.toLowerCase()}.json`
      const mimeType = 'application/vnd.ai-film-flow.asset+json'
      await uploadFile(storageKey, serialized, mimeType)
      const url = await getSignedFileUrl(storageKey)
      const asset = await createUserAssetWithInitialRevision({
        data: { userId, kind: structuredKind(contentType), source: 'MANUAL', contentType, title, description: typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : null, mimeType, storageKey, url, schemaVersion: 1, structuredPayload, metadata: { tags: Array.isArray(body.tags) ? body.tags.filter((tag: unknown) => typeof tag === 'string').slice(0, 20) : [] } },
        contentHash: hashAssetContent(serialized),
      })
      return NextResponse.json({ asset }, { status: 201 })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'STRUCTURED_ASSET_INVALID' }, { status: 400 })
    }
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })

  const kind = parseKind(formData.get('kind'))
  const title = typeof formData.get('title') === 'string' ? String(formData.get('title')).trim() : ''
  const description = typeof formData.get('description') === 'string' ? String(formData.get('description')).trim() : ''
  const tags = typeof formData.get('tags') === 'string'
    ? String(formData.get('tags')).split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20)
    : []

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = file.name || 'asset.png'
  const storageKey = `users/${userId}/assets/${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  await uploadFile(storageKey, buffer, file.type)
  const url = await getSignedFileUrl(storageKey)

  const asset = await createUserAssetWithInitialRevision({
    data: {
      userId,
      kind,
      source: 'UPLOAD',
      title: title || filename,
      description,
      mimeType: file.type,
      storageKey,
      url,
      metadata: { originalFilename: filename, tags },
    },
    contentHash: hashAssetContent(buffer),
  })

  return NextResponse.json({ asset }, { status: 201 })
}
