export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const permission = await checkProjectPermission(project.id)
  if (!permission.allowed) {
    return permission.response
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const shotId = formData.get('shotId') as string | null
    const imageIndex = formData.get('imageIndex') as string | null

    if (!file || !shotId) {
      return NextResponse.json({ error: 'VALID_001', message: '缺少 file 或 shotId' }, { status: 400 })
    }

    const ext = file.name.split('.').pop() || 'png'
    const mimeType = file.type || 'image/png'
    const buffer = Buffer.from(await file.arrayBuffer())
    const idx = imageIndex || '0'
    const storageKey = `projects/${params.id}/storyboard-imported/${shotId}_${idx}.${ext}`

    await uploadFile(storageKey, buffer, mimeType)
    const url = await getSignedFileUrl(storageKey, 3600 * 24 * 7) // 7天（R2最大有效期）

    const asset = await prisma.asset.create({
      data: {
        projectId: params.id,
        type: 'IMAGE',
        url,
        storageKey,
        mimeType,
        metadata: {
          source: 'storyboard-import',
          shotId,
          imageIndex: parseInt(idx),
        },
      },
    })

    return NextResponse.json({ assetId: asset.id, url, shotId })
  } catch (e: any) {
    console.error('[UPLOAD-STORYBOARD-IMAGE] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
