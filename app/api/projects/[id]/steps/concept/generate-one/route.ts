export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getImageClient } from '@/lib/api-clients'
import { getStyleRefUrl } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'

/**
 * 概念图批量生成：立即返回 202，后台并行生成全部图片。
 * 前端通过轮询 GET /concept/status 获取进度。
 *
 * Body: { totalScenes: number, aspectRatio?: string, imageModel?: string }
 * Response: 202 { status: 'ACCEPTED' }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) return access.response

  const body = await req.json().catch(() => ({}))
  const totalScenes = Number(body.totalScenes)
  const aspectRatio = body.aspectRatio || '16:9'
  const imageModel = body.imageModel

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } },
  })
  if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })

  const outputData = (step.outputData as any) || {}
  const prompts: any[] = outputData.prompts || []

  // 立即设置 PROCESSING 并返回 202（不等后台完成）
  await prisma.workflowStep
    .update({
      where: { id: step.id },
      data: { status: 'PROCESSING', errorMessage: null },
    })
    .catch(() => {})

  // 后台：并行生成全部图片
  waitUntil(
    _generateAll(params.id, step.id, outputData, totalScenes, aspectRatio, imageModel).catch((err) => {
      console.error('[CONCEPT-BG] 全部生成异常:', err?.message)
      prisma.workflowStep
        .update({
          where: { id: step.id },
          data: { status: 'FAILED', errorMessage: err.message || '生成失败' },
        })
        .catch(() => {})
    })
  )

  return NextResponse.json({ status: 'ACCEPTED', totalScenes }, { status: 202 })
}

/** 并行生成全部图片（Promise.allSettled） */
async function _generateAll(
  paramsId: string,
  stepId: string,
  outputData: any,
  totalScenes: number,
  aspectRatio: string,
  imageModel?: string
): Promise<void> {
  const prompts: any[] = outputData.prompts || []

  // 并行生成全部场景（每张独立 Promise）
  const tasks = prompts.map((promptItem, i) =>
    _generateOne(paramsId, stepId, i, promptItem, aspectRatio, imageModel)
  )

  // 等待全部完成（无论成功/失败）
  const results = await Promise.allSettled(tasks)

  // 统计结果
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length
  const rejected = results.filter((r) => r.status === 'rejected').length
  console.log(`[CONCEPT-BG] 完成：成功 ${fulfilled}/${totalScenes}，失败 ${rejected}`)

  // 更新 step 状态
  await prisma.workflowStep
    .update({
      where: { id: stepId },
      data: {
        status: 'COMPLETED',
        errorMessage: null,
        outputData: { ...outputData, totalScenes, aspectRatio, imageModel: imageModel || IMAGE_MODELS.primary },
      },
    })
    .catch(() => {})
}

/** 生成并保存单张图片 */
async function _generateOne(
  paramsId: string,
  stepId: string,
  sceneIndex: number,
  promptItem: any,
  aspectRatio: string,
  imageModel?: string
): Promise<void> {
  // 去重检查（用 JS filter 避免 Prisma JSON path 兼容性问题）
  try {
    const allAssets = await prisma.asset.findMany({ where: { projectId: paramsId, stepId } })
    const existing = allAssets.find((a) => (a.metadata as any)?.sceneIndex === sceneIndex)
    if (existing) {
      console.log(`[CONCEPT-BG] sceneIndex=${sceneIndex} 已存在，跳过`)
      return
    }
  } catch (e: any) {
    console.warn(`[CONCEPT-BG] sceneIndex=${sceneIndex} 去重检查失败:`, e?.message)
  }

  // 风格图
  let styleRefUrl = ''
  try {
    const ref = await getStyleRefUrl(paramsId)
    styleRefUrl = ref.styleRefUrl || ''
  } catch (e: any) {
    console.warn(`[CONCEPT-BG] sceneIndex=${sceneIndex} 风格图提取失败:`, e?.message)
  }

  // 角色图
  let characterImageUrls: string[] = []
  try {
    const chars = await prisma.asset.findMany({ where: { projectId: paramsId, step: { stepType: 'CHARACTER' } } })
    characterImageUrls = chars.map((a) => a.url).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
  } catch (e: any) {}

  // 生成
  let result: { url: string; storageKey: string }
  try {
    const client = await getImageClient()
    result = await client.generateConceptScene(
      paramsId,
      promptItem.englishPrompt,
      styleRefUrl,
      '',
      characterImageUrls,
      undefined,
      aspectRatio,
      imageModel
    )
  } catch (genErr: any) {
    console.error(`[CONCEPT-BG] sceneIndex=${sceneIndex} 生成失败:`, genErr?.message)
    throw genErr // 抛出让 Promise.allSettled 捕获
  }

  // 保存（最多 3 次重试）
  for (let retry = 0; retry < 3; retry++) {
    try {
      await prisma.asset.create({
        data: {
          projectId: paramsId,
          stepId,
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
      console.log(`[CONCEPT-BG] sceneIndex=${sceneIndex} 已保存`)
      return
    } catch (saveErr: any) {
      console.warn(`[CONCEPT-BG] sceneIndex=${sceneIndex} 保存失败，重试 ${retry + 1}/3:`, saveErr?.message)
      if (retry < 2) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error(`sceneIndex=${sceneIndex} 多次保存失败`)
}
