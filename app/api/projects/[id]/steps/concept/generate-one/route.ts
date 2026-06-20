export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getImageClient } from '@/lib/api-clients'
import { getStyleRefUrl } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'

/**
 * 概念图单张生成：立即返回 202，后台异步执行生成。
 * 前端通过轮询 GET /concept/status 获取进度。
 *
 * Body: { sceneIndex: number, aspectRatio?: string, imageModel?: string }
 * Response: 202 { status: 'ACCEPTED', sceneIndex }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
  }

  const body = await req.json().catch(() => ({}))
  const sceneIndex = Number(body.sceneIndex)
  if (isNaN(sceneIndex) || sceneIndex < 0) {
    return NextResponse.json({ error: 'VALID_001', message: 'sceneIndex 无效' }, { status: 400 })
  }

  const aspectRatio = body.aspectRatio || '16:9'
  const imageModel = body.imageModel

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } },
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData as any) || {}
  const prompts: any[] = outputData.prompts || []
  const totalScenes = prompts.length

  // 立即返回 202，后台异步执行
  waitUntil(
    (async () => {
      console.log(`[CONCEPT-BG] 开始生成第 ${sceneIndex + 1}/${totalScenes} 张`)

      // 首张设置 PROCESSING
      if (sceneIndex === 0) {
        await prisma.workflowStep.update({
          where: { id: step.id },
          data: { status: 'PROCESSING' as any },
        }).catch(() => {})
      }

      const promptItem = prompts[sceneIndex]
      if (!promptItem) {
        console.error(`[CONCEPT-BG] sceneIndex=${sceneIndex} 无对应 prompt`)
        return
      }

      // 去重检查
      const existingAssets = await prisma.asset.findMany({
        where: { projectId: params.id, stepId: step.id },
      })
      const existing = existingAssets.find((a) => (a.metadata as any)?.sceneIndex === sceneIndex)
      if (existing) {
        console.log(`[CONCEPT-BG] sceneIndex=${sceneIndex} 已存在，跳过`)
        return
      }

      // 获取参考图
      let styleRefUrl = ''
      try {
        const ref = await getStyleRefUrl(params.id)
        styleRefUrl = ref.styleRefUrl
      } catch (refErr: any) {
        console.error('[CONCEPT-BG] 风格图提取失败:', refErr?.message)
        return
      }

      const characterAssets = await prisma.asset.findMany({
        where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
      })
      const characterImageUrls = characterAssets
        .map((a) => a.url)
        .filter((u) => typeof u === 'string' && u.length > 0 && /^https?:\/\//i.test(u))

      // 生成
      const imageClient = await getImageClient()
      console.log('[CONCEPT-BG] 调用 generateConceptScene, prompt:', promptItem.englishPrompt?.slice(0, 60))
      const result = await imageClient.generateConceptScene(
        params.id,
        promptItem.englishPrompt,
        styleRefUrl,
        '',
        characterImageUrls,
        undefined,
        aspectRatio,
        imageModel
      )

      // 保存 asset
      await prisma.asset.create({
        data: {
          projectId: params.id,
          stepId: step.id,
          type: 'IMAGE',
          mimeType: 'image/png',
          storageKey: result.storageKey,
          url: result.url,
          metadata: {
            actNumber: promptItem.actNumber,
            sceneIndex,
            llmPrompt: promptItem.englishPrompt,
            prompt: promptItem.englishPrompt,
            aspectRatio,
            imageModel: imageModel || IMAGE_MODELS.primary,
          },
        },
      })
      console.log(`[CONCEPT-BG] 完成 sceneIndex=${sceneIndex}，isLast=${sceneIndex + 1 >= totalScenes}`)

      // 最后一张标记完成
      if (sceneIndex + 1 >= totalScenes) {
        await prisma.workflowStep.update({
          where: { id: step.id },
          data: {
            status: 'COMPLETED' as any,
            outputData: { ...outputData, totalScenes, aspectRatio, imageModel: imageModel || IMAGE_MODELS.primary },
          },
        }).catch(() => {})
        console.log('[CONCEPT-BG] 全部完成，step 已标记 COMPLETED')
      }
    })()
  )

  return NextResponse.json({ status: 'ACCEPTED', sceneIndex, totalScenes }, { status: 202 })
}
