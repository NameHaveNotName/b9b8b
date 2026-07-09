import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedFileUrl, deleteFile } from '@/lib/r2'

const MAX_REFERENCES = 10
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project) return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    const access = await checkProjectAccess(project.userId)
    if (!access.allowed) return access.response

    const refs = await prisma.asset.findMany({
      where: { projectId: params.id, type: 'REFERENCE', stepId: null },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ references: refs })
  } catch (err: any) {
    console.error('[REFERENCES-GET]', err?.message || err)
    return NextResponse.json({ error: 'WORKFLOW_001', detail: err?.message || 'Unknown error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project) return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    const access = await checkProjectAccess(project.userId)
    if (!access.allowed) return access.response

    const existingCount = await prisma.asset.count({
      where: { projectId: params.id, type: 'REFERENCE', stepId: null },
    })
    if (existingCount >= MAX_REFERENCES) {
      return NextResponse.json({ error: '已达到最大参考图数量（10张）' }, { status: 400 })
    }

    let buffer: Buffer
    let contentType: string
    let filename: string
    let labels: string[] = []
    let sourceUrl: string | null = null

    const formData = await req.formData().catch(() => null)
    if (formData) {
      const file = formData.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
      if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
      if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
      buffer = Buffer.from(await file.arrayBuffer())
      contentType = file.type
      filename = file.name || 'reference.png'
      const labelsRaw = formData.get('labels')
      if (labelsRaw && typeof labelsRaw === 'string') {
        labels = labelsRaw.split(',').map((l: string) => l.trim()).filter(Boolean).slice(0, 10)
      }
    } else {
      const body = await req.json().catch(() => null)
      if (body?.url) {
        let url = body.url.trim()
        if (!url.startsWith('http')) url = 'https://' + url.replace(/^\/\//, '')
        sourceUrl = url
        console.log('[REFERENCES-POST] Downloading from URL:', url)
        const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
        if (!resp.ok) {
          const errorText = await resp.text().catch(() => '')
          return NextResponse.json({ error: `Failed to download image: ${resp.status} ${errorText.slice(0, 100)}` }, { status: 400 })
        }
        const ct = resp.headers.get('content-type') || ''
        if (!ALLOWED_TYPES.includes(ct) && !ct.startsWith('image/')) {
          return NextResponse.json({ error: `Unsupported file type: ${ct}` }, { status: 400 })
        }
        buffer = Buffer.from(await resp.arrayBuffer())
        contentType = ct || 'image/png'
        filename = url.split('/').pop()?.split('?')[0] || 'reference.png'
        if (body.labels && Array.isArray(body.labels)) {
          labels = body.labels.slice(0, 10)
        }
      } else {
        return NextResponse.json({ error: 'No file or URL provided' }, { status: 400 })
      }
    }

    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
    }

    const ext = contentType.split('/')[1] || 'png'
    const storageKey = `projects/${params.id}/references/${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    await uploadFile(storageKey, buffer, contentType)
    const url = await getSignedFileUrl(storageKey, 3600)

    const asset = await prisma.asset.create({
      data: {
        projectId: params.id,
        type: 'REFERENCE',
        mimeType: contentType,
        storageKey,
        url,
        metadata: { labels, sourceUrl },
      },
    })

    console.log(`[REFERENCES-POST] Created reference asset ${asset.id}, key=${storageKey}`)
    return NextResponse.json({ reference: asset }, { status: 201 })
  } catch (err: any) {
    console.error('[REFERENCES-POST]', err?.message || err)
    return NextResponse.json({ error: 'WORKFLOW_001', detail: err?.message || 'Unknown error' }, { status: 500 })
  }
}