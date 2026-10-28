export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { readFile } from 'fs/promises'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { ensureUserAssetsTable } from '@/lib/ensure-user-assets'
import { getSignedFileUrl, uploadFile } from '@/lib/r2'

const KINDS = new Set(['CHARACTER', 'ENVIRONMENT', 'STYLE', 'OBJECT', 'BRAND', 'REFERENCE'])

function inferKind(stepType?: string | null) {
  if (stepType === 'CHARACTER') return 'CHARACTER'
  if (stepType === 'STYLE') return 'STYLE'
  if (stepType === 'CONCEPT' || stepType === 'STORYBOARD' || stepType === 'KEYFRAMES') return 'ENVIRONMENT'
  return 'REFERENCE'
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  await ensureUserAssetsTable()
  const body = await req.json().catch(() => ({}))
  const assetId = typeof body.assetId === 'string' ? body.assetId : ''
  if (!assetId) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })

  const projectAsset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { step: { select: { stepType: true } } },
  })
  if (!projectAsset || !['IMAGE', 'REFERENCE'].includes(projectAsset.type)) {
    return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  }
  const sourceStep = Array.isArray((projectAsset as any).step) ? (projectAsset as any).step[0] : projectAsset.step
  const access = await checkProjectPermission(projectAsset.projectId)
  if (!access.allowed) return access.response

  const duplicate = await prisma.userAsset.findFirst({
    where: { userId: user.id, metadata: { path: ['sourceAssetId'], equals: projectAsset.id } },
  })
  if (duplicate) return NextResponse.json({ asset: duplicate, duplicate: true })

  const kind = KINDS.has(body.kind) ? body.kind : inferKind(sourceStep?.stepType)
  const metadata = (projectAsset.metadata || {}) as any
  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : metadata.characterName || metadata.sceneName || metadata.shotId || `${sourceStep?.stepType || '项目'}素材`
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag: unknown) => typeof tag === 'string').map((tag: string) => tag.trim()).filter(Boolean).slice(0, 20)
    : []

  let sourceUrl = projectAsset.url
  try { sourceUrl = await getSignedFileUrl(projectAsset.storageKey, 600) } catch {}
  let buffer: Buffer
  if (sourceUrl.startsWith('/')) {
    const absolutePath = path.join(process.cwd(), 'public', sourceUrl.replace(/^\/+/, ''))
    buffer = await readFile(absolutePath)
  } else {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) return NextResponse.json({ error: 'STORAGE_002', message: '无法读取项目图片' }, { status: 502 })
    buffer = Buffer.from(await response.arrayBuffer())
  }

  const extension = projectAsset.mimeType.includes('jpeg') ? 'jpg' : projectAsset.mimeType.includes('webp') ? 'webp' : 'png'
  const storageKey = `users/${user.id}/assets/project_${projectAsset.id}_${Date.now()}.${extension}`
  await uploadFile(storageKey, buffer, projectAsset.mimeType)
  const url = await getSignedFileUrl(storageKey)
  const asset = await prisma.userAsset.create({
    data: {
      userId: user.id,
      kind,
      source: 'PROJECT',
      title,
      description: typeof body.description === 'string' ? body.description.trim() : null,
      prompt: metadata.prompt || metadata.llmPrompt || null,
      mimeType: projectAsset.mimeType,
      storageKey,
      url,
      metadata: {
        tags,
        sourceProjectId: projectAsset.projectId,
        sourceAssetId: projectAsset.id,
        sourceStepType: sourceStep?.stepType || null,
      },
    },
  })
  return NextResponse.json({ asset }, { status: 201 })
}
