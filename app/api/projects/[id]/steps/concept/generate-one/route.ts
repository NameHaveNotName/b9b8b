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
    _bgGenerate(params.id, step.id, outputData, sceneIndex, totalScenes, aspectRatio, imageModel).catch(
      (err: any) => {
        console.error(`[CONCEPT-BG] sceneIndex=${sceneIndex} 背景任务失败:`, err?.message)
        // 标记该 step 为失败（仅最后一张）
        if (sceneIndex + 1 >= totalScenes) {
          prisma.workflowStep
            .update({
              where: { id: step.id },
              data: { status: 'FAILED', errorMessage: err.message || '生成失败' },
            })
            .catch(() => {})
        }
      }
    )
  )

  return NextResponse.json({ status: 'ACCEPTED', sceneIndex, totalScenes }, { status: 202 })
}

/** 后台生成逻辑（被 waitUntil 包装执行，不受 HTTP 请求生命周期限制） */
async function _bgGenerate(
  paramsId: string,
  stepId: string,
  outputData: any,
  sceneIndex: number,
  totalScenes: number,
  aspectRatio: string,
  imageModel?: string
): Promise<void> {
  console.log(`[CONCEPT-BG] 开始生成第 ${sceneIndex + 1}/${totalScenes} 张`)

  // 首张：重置状态（清除 CANCELLED / FAILED + errorMessage）
  if (sceneIndex === 0) {
    try {
      await prisma.workflowStep.update({
        where: { id: stepId },
        data: { status: 'PROCESSING', errorMessage: null },
      })
    } catch (e: any) {
      console.warn('[CONCEPT-BG] 状态重置失败:', e?.message)
    }
  }

  const prompts: any[] = outputData.prompts || []
  const promptItem = prompts[sceneIndex]
  if (!promptItem) {
    console.error(`[CONCEPT-BG] sceneIndex=${sceneIndex} 无对应 prompt`)
    return
  }

  // 去重检查（已有则跳过）
  try {
    const existingAssets = await prisma.asset.findMany({
      where: { projectId: paramsId, stepId },
    })
    const existing = existingAssets.find((a) => (a.metadata as any)?.sceneIndex === sceneIndex)
    if (existing) {
      console.log(`[CONCEPT-BG] sceneIndex=${sceneIndex} 已存在，跳过`)
      return
    }
  } catch (e: any) {
    console.warn('[CONCEPT-BG] 去重检查失败:', e?.message)
  }

  // 获取风格图（失败不阻止生成）
  let styleRefUrl = ''
  try {
    const ref = await getStyleRefUrl(paramsId)
    styleRefUrl = ref.styleRefUrl || ''
  } catch (refErr: any) {
    console.warn('[CONCEPT-BG] 风格图提取失败，继续生成:', refErr?.message)
  }

  // 获取角色图
  let characterImageUrls: string[] = []
  try {
    const characterAssets = await prisma.asset.findMany({
      where: { projectId: paramsId, step: { stepType: 'CHARACTER' } },
    })
    characterImageUrls = characterAssets
      .map((a) => a.url)
      .filter((u) => typeof u === 'string' && u.length > 0 && /^https?:\/\//i.test(u))
  } catch (e: any) {
    console.warn('[CONCEPT-BG] 角色图获取失败:', e?.message)
  }

  // 生成图片
  const imageClient = await getImageClient()
  console.log('[CONCEPT-BG] 调用 generateConceptScene, prompt:', promptItem.englishPrompt?.slice(0, 60))
  let result: { url: string; storageKey: string; metadata: any }
  try {
    result = await imageClient.generateConceptScene(
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
    return // 单张失败不阻止其他
  }

  // 保存到 DB（带重试，防止写入被中断）
  let saved = false
  for (let retry = 0; retry < 3 && !saved; retry++) {
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
      saved = true
      console.log(`[CONCEPT-BG] 完成 sceneIndex=${sceneIndex}，已保存到 DB`)
    } catch (saveErr: any) {
      console.warn(`[CONCEPT-BG] sceneIndex=${sceneIndex} 保存失败，重试 ${retry + 1}/3:`, saveErr?.message)
      if (retry < 2) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  if (!saved) {
    console.error(`[CONCEPT-BG] sceneIndex=${sceneIndex} 多次保存失败，跳过`)
    return
  }

  // 最后一张：标记 COMPLETED
  if (sceneIndex + 1 >= totalScenes) {
    try {
      await prisma.workflowStep.update({
        where: { id: stepId },
        data: {
          status: 'COMPLETED',
          errorMessage: null,
          outputData: { ...outputData, totalScenes, aspectRatio, imageModel: imageModel || IMAGE_MODELS.primary },
        },
      })
      console.log('[CONCEPT-BG] 全部完成，step 已标记 COMPLETED')
    } catch (e: any) {
      console.error('[CONCEPT-BG] 标记 COMPLETED 失败:', e?.message)
    }
  }
}
