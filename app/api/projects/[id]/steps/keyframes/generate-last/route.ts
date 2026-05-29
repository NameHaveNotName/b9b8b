import { NextResponse } from 'next/server'
import { auth, isDemoMode, DEMO_USER } from '@/auth'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { getStyleRefUrl } from '@/lib/style-ref'

/**
 * 单条尾帧生成 API
 * POST /api/projects/[id]/steps/keyframes/generate-last
 * Body: { shotId: string }
 *
 * 从 STORYBOARD 步骤读取对应 shot 的 firstFrameUrl/description，
 * 调用尾帧生成，然后将 lastFrameUrl 写回 STORYBOARD.outputData.shots
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  const isOwner = project?.userId === session.user.id
  const isDemoProject = isDemoMode && project?.userId === DEMO_USER.id

  if (!project || (!isOwner && !isDemoProject)) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const body = await _req.json().catch(() => null)
  if (!body?.shotId) {
    return NextResponse.json({ error: '需要 shotId' }, { status: 400 })
  }

  // 从 STORYBOARD 步骤读取 shots
  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  if (!storyboardStep || storyboardStep.status !== 'COMPLETED') {
    return NextResponse.json({ error: '请先完成分镜设计' }, { status: 400 })
  }

  const storyboardShots = (storyboardStep.outputData as any)?.shots || []
  const shot = storyboardShots.find((s: any) => s.shotId === body.shotId)
  if (!shot) {
    return NextResponse.json({ error: `未找到 shot: ${body.shotId}` }, { status: 404 })
  }

  // 获取 KEYFRAMES 步骤（用于创建 Asset 记录）
  let keyframesStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'KEYFRAMES' } }
  })
  if (!keyframesStep) {
    // 如果 KEYFRAMES 步骤不存在，创建一个 PENDING 状态的空步骤
    keyframesStep = await prisma.workflowStep.create({
      data: {
        projectId: params.id,
        stepType: 'KEYFRAMES',
        status: 'PENDING',
        order: 8,
        outputData: {},
      }
    })
  }

  console.log('[KEYFRAMES-GENERATE-LAST] shotId:', shot.shotId, 'description:', shot.description?.slice(0, 60))

  try {
    // 获取风格参考
    let styleRefUrl: string
    let stylePrompt: string
    try {
      const ref = await getStyleRefUrl(params.id)
      styleRefUrl = ref.styleRefUrl
      stylePrompt = ref.stylePrompt || 'cinematic film still, 35mm Kodak Portra 400, soft grain, atmospheric depth, 8K'
    } catch (refErr: any) {
      console.error('[KEYFRAMES-GENERATE-LAST] 风格参考获取失败:', refErr?.message)
      return NextResponse.json(
        { error: '未找到有效风格参考图' },
        { status: 400 }
      )
    }

    // 生成尾帧图像提示词
    const textClient = await getTextClient()
    const promptTemplate = loadPromptTemplate('keyframe-last', {
      STYLE_REF: stylePrompt,
      USER_INPUT: shot.description || `${shot.shotId} - ${shot.sceneName || ''}`,
    })
    const generatedPrompt = await textClient.generate(promptTemplate, { temperature: 0.7, maxTokens: 1024 })
    const parsed = extractJsonFromMarkdown(generatedPrompt)
    const imagePrompt = parsed.keyframe?.imagePrompt || generatedPrompt

    console.log('[KEYFRAMES-GENERATE-LAST] 尾帧图像提示词生成完成')

    // 调用图像生成
    const imageClient = await getImageClient()
    const result = await imageClient.generateKeyframe(
      params.id,
      imagePrompt,
      styleRefUrl,
      'last'
    )

    // 创建 Asset 记录
    const asset = await prisma.asset.create({
      data: {
        projectId: params.id,
        stepId: keyframesStep.id,
        type: 'IMAGE',
        mimeType: 'image/png',
        storageKey: `projects/${params.id}/keyframes/${shot.shotId}_last.png`,
        url: result.url,
        metadata: { pairId: shot.shotId, frameType: 'last', sceneDesc: shot.description, llmPrompt: generatedPrompt },
      }
    })

    // 将 lastFrameUrl 写回 STORYBOARD 步骤的 shots 数组
    const updatedShots = storyboardShots.map((s: any) =>
      s.shotId === body.shotId ? { ...s, lastFrameUrl: result.url } : s
    )
    await prisma.workflowStep.update({
      where: { id: storyboardStep.id },
      data: { outputData: { ...(storyboardStep.outputData as any), shots: updatedShots } }
    })

    // 同步更新 KEYFRAMES 步骤的 outputData（保留兼容性）
    const kfOutputData = (keyframesStep.outputData as any) || {}
    const kfResults = (kfOutputData.results || []).filter((r: any) => r.shotId !== body.shotId)
    kfResults.push({
      shotId: body.shotId,
      firstFrameUrl: shot.firstFrameUrl || shot.referenceImageUrl || '',
      lastFrameUrl: result.url,
      description: shot.description,
      actionChange: '',
    })
    await prisma.workflowStep.update({
      where: { id: keyframesStep.id },
      data: { outputData: { ...kfOutputData, results: kfResults, keyframes: kfResults } }
    })

    console.log('[KEYFRAMES-GENERATE-LAST] 尾帧生成完成, lastFrameUrl:', result.url?.slice(0, 80))

    return NextResponse.json({
      success: true,
      lastFrameUrl: result.url,
      assetId: asset.id,
    })
  } catch (e: any) {
    console.error('[KEYFRAMES-GENERATE-LAST] 生成失败:', e.message)
    return NextResponse.json({ error: 'KEYFRAMES_001', message: e.message }, { status: 500 })
  }
}
