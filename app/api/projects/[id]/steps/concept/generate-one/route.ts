export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getImageClient } from '@/lib/api-clients'
import { getStyleRefUrl } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'

/**
 * 前端驱动分批生成：每次只生成 1 张图，避免 Vercel Hobby 60s 超时。
 * 前端递归调用直到全部完成，每张图单独请求、独立生命周期。
 *
 * Body: { sceneIndex: number, aspectRatio?: string, imageModel?: string }
 * Response: { success, sceneIndex, asset, hasMore }
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

  // 读取 concept step 和 prompts
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } },
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData as any) || {}
  const prompts: any[] = outputData.prompts || []

  // 也支持无 prompts 时自动生成（兜底）
  let promptItem = prompts[sceneIndex]
  if (!promptItem) {
    // 没有保存的 prompts，从 framework 实时生成
    return NextResponse.json({ error: 'VALID_002', message: '提示词未生成，请先点击"生成概念图"生成提示词' }, { status: 400 })
  }

  // 去重：已生成则直接返回已有结果（用 JS 过滤避免 Prisma JSON path 查询兼容性问题）
  const existingAssets = await prisma.asset.findMany({
    where: { projectId: params.id, stepId: step.id },
  })
  const existing = existingAssets.find((a) => (a.metadata as any)?.sceneIndex === sceneIndex)
  if (existing) {
    const totalScenes = prompts.length
    return NextResponse.json({
      success: true,
      sceneIndex,
      asset: {
        id: existing.id,
        url: existing.url,
        metadata: existing.metadata,
      },
      hasMore: sceneIndex + 1 < totalScenes,
      totalScenes,
      duplicate: true,
    })
  }

  // 获取风格图和角色图
  let styleRefUrl = ''
  let stylePrompt = ''
  try {
    const ref = await getStyleRefUrl(params.id)
    styleRefUrl = ref.styleRefUrl
    stylePrompt = ref.stylePrompt
  } catch (refErr: any) {
    return NextResponse.json(
      { error: 'STORAGE_001', message: refErr?.message || '未找到有效风格参考图' },
      { status: 400 }
    )
  }

  const characterAssets = await prisma.asset.findMany({
    where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
  })

  // 【调试日志】确认 API 配置
  console.log('[CONCEPT-GEN-ONE] 请求参数:', { sceneIndex, aspectRatio, imageModel })
  console.log('[CONCEPT-GEN-ONE] XIAOMI_BASE_URL:', process.env.XIAOMI_BASE_URL || '(未设置，使用默认 yunwu.ai)')
  console.log('[CONCEPT-GEN-ONE] XIAOMI_API_KEY 前8位:', process.env.XIAOMI_API_KEY?.slice(0, 8) || '(未设置)')
  const characterImageUrls = characterAssets
    .map((a) => a.url)
    .filter((u) => typeof u === 'string' && u.length > 0 && /^https?:\/\//i.test(u))

  const imageClient = await getImageClient()
  console.log('[CONCEPT-GEN-ONE] 准备调用 generateConceptScene，prompt 前80字符:', promptItem.englishPrompt.slice(0, 80))
  const result = await imageClient.generateConceptScene(
    params.id,
    promptItem.englishPrompt,
    styleRefUrl,
    stylePrompt,
    characterImageUrls,
    undefined,
    aspectRatio,
    imageModel
  )

  const asset = await prisma.asset.create({
    data: {
      projectId: params.id,
      stepId: step.id,
      type: 'IMAGE',
      mimeType: 'image/png',
      storageKey: result.storageKey,
      url: result.url,
      metadata: {
        ...result.metadata,
        actNumber: promptItem.actNumber,
        sceneIndex: sceneIndex,
        llmPrompt: promptItem.englishPrompt,
        prompt: promptItem.englishPrompt,
        aspectRatio,
        imageModel: imageModel || IMAGE_MODELS.primary,
      },
    },
  })

  const totalScenes = prompts.length
  console.log(`[CONCEPT-GEN-ONE] 完成第 ${sceneIndex + 1}/${totalScenes} 张，hasMore=${sceneIndex + 1 < totalScenes}`)

  return NextResponse.json({
    success: true,
    sceneIndex,
    asset: {
      id: asset.id,
      url: asset.url,
      metadata: asset.metadata,
    },
    hasMore: sceneIndex + 1 < totalScenes,
    totalScenes,
    isMock: !!result.metadata?.isMock,
  })
}