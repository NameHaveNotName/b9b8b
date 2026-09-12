export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { WorkflowStepType } from '@prisma/client'
import { parseXlsxWithImages, type ExtractedImage } from '@/lib/storyboard-xlsx-parser'
import { importStoryboardShots } from '@/lib/storyboard-import'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const mode = formData.get('mode') as 'ai_complete' | 'skip_framework' | null
    const shotIdColOverride = formData.get('shotIdCol') ? parseInt(formData.get('shotIdCol') as string) : null
    const imageColOverride = formData.get('imageCol') ? parseInt(formData.get('imageCol') as string) : null
    const title = (formData.get('title') as string) || ''

    if (!file) {
      return NextResponse.json({ error: 'VALID_001', message: '请上传文件' }, { status: 400 })
    }

    if (!mode || !['ai_complete', 'skip_framework'].includes(mode)) {
      return NextResponse.json({ error: 'VALID_002', message: '请选择导入模式' }, { status: 400 })
    }

    // 解析文件名作为项目标题
    const projectTitle = title.trim() || file.name.replace(/\.xlsx$/i, '').trim() || '未命名项目'

    // 1. 解析 xlsx
    const buffer = Buffer.from(await file.arrayBuffer())
    const parseResult = await parseXlsxWithImages(buffer)

    if (parseResult.shots.length === 0) {
      return NextResponse.json({ error: 'VALID_003', message: '未在文件中检测到分镜数据' }, { status: 400 })
    }

    // 2. 创建项目
    const stepTypes: WorkflowStepType[] = [
      'IDEATION', 'FRAMEWORK', 'STYLE', 'CHARACTER', 'CONCEPT', 'TRAILER',
      'STORYBOARD', 'KEYFRAMES', 'VIDEO_DIRECT', 'VIDEO_RENDER', 'CAMERA', 'REVIEW',
    ]

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        title: projectTitle,
        rawIdea: '',
        status: 'ACTIVE',
      },
    })

    // 创建所有 workflow steps
    await prisma.workflowStep.createMany({
      data: stepTypes.map((type, idx) => ({
        projectId: project.id,
        stepType: type,
        order: idx,
        status: 'PENDING' as const,
      })),
    })

    // 3. 上传图片到 R2 并创建 Asset
    const firstFrameMap: Record<string, { url: string; assetId?: string }> = {}

    for (const img of parseResult.images) {
      const storageKey = `projects/${project.id}/storyboard-imported/${img.shotId}_${img.imageIndex}.${img.mimeType.split('/')[1] || 'png'}`

      try {
        await uploadFile(storageKey, img.buffer, img.mimeType)
        const url = await getSignedFileUrl(storageKey, 3600 * 24 * 365) // 1年有效期

        // 创建 Asset 记录
        const asset = await prisma.asset.create({
          data: {
            projectId: project.id,
            type: 'IMAGE',
            url,
            storageKey,
            mimeType: img.mimeType,
            metadata: {
              source: 'storyboard-import',
              shotId: img.shotId,
              imageIndex: img.imageIndex,
              originalFileName: img.fileName,
            },
          },
        })

        // 首帧图：只取每 shot 的第一张
        if (!firstFrameMap[img.shotId]) {
          firstFrameMap[img.shotId] = { url, assetId: asset.id }
        }
      } catch (e: any) {
        console.error(`[CREATE-FROM-STORYBOARD] 图片上传失败 shotId=${img.shotId}:`, e?.message)
      }
    }

    // 4. 导入分镜
    const importResult = await importStoryboardShots({
      projectId: project.id,
      shots: parseResult.shots,
      mode,
      firstFrameMap,
    })

    console.log(`[CREATE-FROM-STORYBOARD] 创建项目 ${project.id}，导入 ${importResult.shotsCount} 个分镜，${Object.keys(firstFrameMap).length} 张首帧图`)

    return NextResponse.json({
      success: true,
      projectId: project.id,
      shotsCount: importResult.shotsCount,
      imagesUploaded: Object.keys(firstFrameMap).length,
      mode,
    })
  } catch (e: any) {
    console.error('[CREATE-FROM-STORYBOARD] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
