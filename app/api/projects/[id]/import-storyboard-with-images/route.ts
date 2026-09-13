export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { importStoryboardShots } from '@/lib/storyboard-import'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const permission = await checkProjectPermission(params.id)
  if (!permission.allowed) {
    return permission.response
  }
  const project = permission.project

  try {
    const formData = await req.formData()
    const shotsJson = formData.get('shots') as string | null
    const mode = formData.get('mode') as 'ai_complete' | 'skip_framework' | null

    if (!shotsJson) {
      return NextResponse.json({ error: 'VALID_001', message: '缺少 shots 数据' }, { status: 400 })
    }
    if (!mode || !['ai_complete', 'skip_framework'].includes(mode)) {
      return NextResponse.json({ error: 'VALID_002', message: '请选择导入模式' }, { status: 400 })
    }

    const shots = JSON.parse(shotsJson)
    if (!Array.isArray(shots) || shots.length === 0) {
      return NextResponse.json({ error: 'VALID_003', message: 'shots 数据为空' }, { status: 400 })
    }

    // 1. 上传图片到 R2 并创建 Asset
    const firstFrameMap: Record<string, { url: string; assetId?: string }> = {}
    const imageEntries = formData.getAll('images') as File[]

    // 从文件名解析 shotId 和 imageIndex: 格式 shotId_index.ext
    for (const file of imageEntries) {
      const nameMatch = file.name.match(/^(.+?)_(\d+)\.\w+$/)
      if (!nameMatch) continue

      const shotId = nameMatch[1]
      const imageIndex = parseInt(nameMatch[2])

      // 只取每 shot 的第一张作为首帧
      if (firstFrameMap[shotId]) continue

      const ext = file.name.split('.').pop() || 'png'
      const mimeType = file.type || 'image/png'
      const buffer = Buffer.from(await file.arrayBuffer())

      const storageKey = `projects/${params.id}/storyboard-imported/${shotId}_${imageIndex}.${ext}`

      try {
        await uploadFile(storageKey, buffer, mimeType)
        const url = await getSignedFileUrl(storageKey, 3600 * 24 * 365)

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
              imageIndex,
            },
          },
        })

        firstFrameMap[shotId] = { url, assetId: asset.id }
      } catch (e: any) {
        console.error(`[IMPORT-STORYBOARD-WITH-IMAGES] 图片上传失败 shotId=${shotId}:`, e?.message)
      }
    }

    // 2. 导入分镜
    const importResult = await importStoryboardShots({
      projectId: params.id,
      shots,
      mode,
      firstFrameMap,
    })

    console.log(`[IMPORT-STORYBOARD-WITH-IMAGES] 导入 ${importResult.shotsCount} 个分镜，${Object.keys(firstFrameMap).length} 张首帧图`)

    return NextResponse.json({
      success: true,
      shotsCount: importResult.shotsCount,
      imagesUploaded: Object.keys(firstFrameMap).length,
      mode,
    })
  } catch (e: any) {
    console.error('[IMPORT-STORYBOARD-WITH-IMAGES] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
