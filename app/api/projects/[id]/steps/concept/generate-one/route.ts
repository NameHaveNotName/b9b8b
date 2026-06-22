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
 * 概念图分批生成：立即返回 202，后台按 act 串行生成该幕的 1-2 张图片。
 * 前端通过 GET /concept/status 轮询进度。
 *
 * Body: { actNumber: number, aspectRatio?: string, imageModel?: string }
 * Response: 202 { status: 'ACCEPTED', actNumber }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) return access.response

  const body = await req.json().catch(() => ({}))
  const actNumber = Number(body.actNumber)
  if (isNaN(actNumber) || actNumber < 0) {
    return NextResponse.json({ error: 'VALID_001', message: 'actNumber 无效' }, { status: 400 })
  }
  const aspectRatio = body.aspectRatio || '16:9'
  const imageModel = body.imageModel

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } },
  })
  if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })

  const outputData = (step.outputData as any) || {}
  const prompts: any[] = outputData.prompts || []

  // 立即标记该 act 为 PROCESSING（不改变整个 step 的 status）
  const actProgress: Record<string, string> = outputData.actProgress || {}
  actProgress[String(actNumber)] = 'PROCESSING'

  await prisma.workflowStep
    .update({
      where: { id: step.id },
      data: {
        status: 'PROCESSING',
        errorMessage: null,
        outputData: { ...outputData, actProgress },
      },
    })
    .catch(() => {})

  // 后台：串行生成该 act 的所有场景
  waitUntil(
    _generateAct(params.id, step.id, outputData, actNumber, aspectRatio, imageModel).catch((err) => {
      console.error('[CONCEPT-BG] act', actNumber, '生成异常:', err?.message)
      const failProgress = { ...actProgress, [String(actNumber)]: 'FAILED' }
      prisma.workflowStep
        .update({
          where: { id: step.id },
          data: {
            outputData: { ...outputData, actProgress: failProgress },
          },
        })
        .catch(() => {})
    })
  )

  return NextResponse.json({ status: 'ACCEPTED', actNumber }, { status: 202 })
}

/** 按幕串行生成所有场景（每个场景 CPU 时间约 5-10s，总时间 = scenes × 10s，远低于 Vercel CPU 上限） */
async function _generateAct(
  paramsId: string,
  stepId: string,
  outputData: any,
  actNumber: number,
  aspectRatio: string,
  imageModel?: string
): Promise<void> {
  const prompts: any[] = outputData.prompts || []
  // 筛选当前 act 的所有场景
  const actPrompts = prompts
    .map((p: any, i: number) => ({ ...p, _idx: i }))
    .filter((p: any) => p.actNumber === actNumber)

  if (actPrompts.length === 0) {
    console.log(`[CONCEPT-BG] act ${actNumber} 无场景，跳过`)
    return
  }

  console.log(`[CONCEPT-BG] 开始生成 act ${actNumber}，共 ${actPrompts.length} 个场景`)

  // 串行生成（CPU 时间可控）
  for (const promptItem of actPrompts) {
    await _generateOne(paramsId, stepId, promptItem._idx, promptItem, aspectRatio, imageModel)
  }

  // 该 act 全部完成，标记为 COMPLETED
  const actProgress: Record<string, string> = outputData.actProgress || {}
  actProgress[String(actNumber)] = 'COMPLETED'

  // 检查是否所有 act 都完成
  const allDone = Object.values(actProgress).every((s) => s === 'COMPLETED')

  await prisma.workflowStep
    .update({
      where: { id: stepId },
      data: {
        status: allDone ? 'COMPLETED' : 'PROCESSING',
        errorMessage: null,
        outputData: { ...outputData, actProgress },
      },
    })
    .catch(() => {})

  console.log(`[CONCEPT-BG] act ${actNumber} 完成，actProgress:`, actProgress)
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
  // 去重检查（已有则跳过）
  try {
    const all = await prisma.asset.findMany({ where: { projectId: paramsId, stepId } })
    if (all.find((a) => (a.metadata as any)?.sceneIndex === sceneIndex)) {
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
    throw genErr
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
