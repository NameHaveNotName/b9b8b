export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import {
  safeSegment,
  resolveUploadExtension,
  isUploadSizeAllowed,
} from '@/lib/upload-safety'

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

    // shotId 与扩展名都来自用户输入，直接拼进 storageKey：
    // 未清洗时 `shotId=../../..` 能逃出存储根目录，`.html` 扩展名能落地成 XSS
    const ext = resolveUploadExtension(file, { allowSvg: false })
    if (!ext) {
      return NextResponse.json(
        { error: 'VALID_002', message: '仅支持 PNG / JPEG / WebP / GIF / AVIF 图片' },
        { status: 400 }
      )
    }
    if (!isUploadSizeAllowed(file.size)) {
      return NextResponse.json(
        { error: 'VALID_003', message: `文件大小必须在 10MB 以内（当前 ${file.size} 字节）` },
        { status: 400 }
      )
    }
    const mimeType = file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const idx = imageIndex || '0'
    const safeShotId = safeSegment(shotId, 'shot')
    const safeIdx = safeSegment(idx, '0', 8)
    const storageKey = `projects/${params.id}/storyboard-imported/${safeShotId}_${safeIdx}.${ext}`

    await uploadFile(storageKey, buffer, mimeType)
    // 预签名 URL 最长 7 天（R2 SigV4 上限），而这个 URL 会被永久写进
    // WorkflowStep.outputData.shots[].firstFrameUrl —— 过期后所有首帧图 403。
    // 因此必须把 storageKey 一起返回并落库，服务端在真正需要取图时按
    // storageKey 重新签发（见 lib/resolve-media-url.ts）。
    const url = await getSignedFileUrl(storageKey, 3600 * 24 * 7)

    // 挂到 STORYBOARD 步骤上：不挂 stepId 的话导入的图片永远不会出现在
    // step.resultAssets，分镜表幕头部按 resultAssets 统计时会恒显示「未生成」
    const storyboardStep = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } },
      select: { id: true },
    })

    const asset = await prisma.asset.create({
      data: {
        projectId: params.id,
        createdById: userId,
        stepId: storyboardStep?.id ?? null,
        origin: 'IMPORTED',
        type: 'IMAGE',
        url,
        storageKey,
        mimeType,
        metadata: {
          source: 'storyboard-import',
          shotId,
          imageIndex: parseInt(idx, 10) || 0,
        },
      },
    })

    return NextResponse.json({ assetId: asset.id, url, storageKey, shotId })
  } catch (e: any) {
    console.error('[UPLOAD-STORYBOARD-IMAGE] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
