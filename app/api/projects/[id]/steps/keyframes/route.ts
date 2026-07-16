export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { getStyleRefUrl, getProjectReferences } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
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

  if (!await canExecuteStep(params.id, 'KEYFRAMES')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  if (!storyboardStep || storyboardStep.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'WORKFLOW_003' }, { status: 400 })
  }

  // Phase 4: 从分镜设计读取起始帧
  const storyboardShots = (storyboardStep.outputData as any)?.shots || []
  const shotsWithFirstFrame = storyboardShots.filter((s: any) => s.firstFrameUrl)
  if (shotsWithFirstFrame.length === 0) {
    return NextResponse.json(
      { error: 'WORKFLOW_005', message: '请先完成分镜设计的视频生成模式，生成起始帧' },
      { status: 400 }
    )
  }

  let step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'KEYFRAMES' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  if (step.status === 'COMPLETED' && step.outputData) {
    console.log('[KEYFRAMES] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  const body = await _req.json().catch(() => ({}))
  const force = body?.force === true
  const action: 'generate-prompts' | 'generate-images' = body?.action || 'generate-images'

  // === generate-prompts: 只生成尾帧提示词，不生图 ===
  if (action === 'generate-prompts') {
    try {
      console.log('[KEYFRAMES-PROMPT] 收到 generate-prompts 请求')

      const imageClient = await getImageClient()
      const textClient = await getTextClient()

      let styleRefUrl: string
      let selectedStylePrompt: string
      try {
        const ref = await getStyleRefUrl(params.id)
        styleRefUrl = ref.styleRefUrl
        selectedStylePrompt = ref.stylePrompt ||
          'cinematic film still, 35mm Kodak Portra 400, soft grain, atmospheric depth, 8K'
      } catch (refErr: any) {
        console.error('[KEYFRAMES-PROMPT] 风格图提取失败：', refErr?.message)
        return NextResponse.json(
          { error: 'STORAGE_001', message: refErr?.message || '未找到有效风格参考图 URL' },
          { status: 400 }
        )
      }

      const prompts = []
      const keyRefs = await getProjectReferences(params.id).catch(() => [])
      const keyRefLabels = keyRefs.filter((r: any) => r.labels?.length).flatMap((r: any) => r.labels)
      const keyRefHint = keyRefs.length > 0
        ? `\n【参考图】${keyRefs.length} 张用户参考图${keyRefLabels.length > 0 ? `（标签：${keyRefLabels.join('、')}）` : ''}。生成 imagePrompt 时可以直接引用参考图中的人物，无需重新描述外貌。`
        : ''

      for (const shot of shotsWithFirstFrame) {
        const lastPrompt = loadPromptTemplate('keyframe-last', {
          STYLE_REF: selectedStylePrompt,
          USER_INPUT: (shot.description || `${shot.shotId} - ${shot.sceneName}`) + keyRefHint,
        })
        const lastPromptText = await textClient.generate(lastPrompt, { temperature: 0.7, maxTokens: 1024 })
        const parsedLast = extractJsonFromMarkdown(lastPromptText)
        const lastImagePrompt = parsedLast.keyframe?.imagePrompt || lastPromptText

        prompts.push({
          id: `prompt_${shot.shotId}`,
          chineseDesc: shot.description || '',
          englishPrompt: lastImagePrompt,
          target: `keyframe_${shot.shotId}_last`,
          shotId: shot.shotId,
          firstFrameUrl: shot.firstFrameUrl || '',
        })
      }

      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: 'PENDING' as any,
          outputData: {
            ...(step.outputData as any || {}),
            prompts,
            keyframes: shotsWithFirstFrame.map((s: any) => ({
              shotId: s.shotId,
              firstFrameUrl: s.firstFrameUrl,
              description: s.description,
            })),
          },
        },
      })

      console.log(`[KEYFRAMES-PROMPT] 生成 ${prompts.length} 条提示词，等待用户确认`)
      return NextResponse.json({ success: true, status: 'PROMPT_READY', prompts })
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || /aborted|timeout|timed out/i.test(e?.message || '')
      const errorMessage = isAbort
        ? '提示词生成超时（模型响应较慢），请稍后重试'
        : e.message
      console.error(`[KEYFRAMES-PROMPT] 失败: ${errorMessage}`, e?.stack?.slice(0, 300))
      await failStep(step.id, errorMessage)
      return NextResponse.json({ error: 'API_001', message: errorMessage }, { status: 500 })
    }
  }

  // === generate-images: 读取已保存提示词，执行生图 ===
  if (action === 'generate-images') {
    const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

    const aspectRatio = body?.aspectRatio || '16:9'
    const imageModel = body?.imageModel
    console.log(`[ASPECT-RATIO] [KEYFRAMES-IMAGE] 用户选择比例: ${aspectRatio}`)
    console.log(`[MODEL-SELECT] [KEYFRAMES-IMAGE] 用户选择模型: ${imageModel || '默认'}`)

    const existingOutput = (step.outputData as any) || {}
    const prompts = existingOutput.prompts || []
    console.log('[KEYFRAMES-IMAGE] existingOutput keys:', Object.keys(existingOutput))
    console.log('[KEYFRAMES-IMAGE] prompts count:', prompts.length)
    if (prompts.length === 0) {
      console.error('[KEYFRAMES-IMAGE] No prompts found. existingOutput:', JSON.stringify(existingOutput).slice(0, 500))
      return NextResponse.json({ error: 'No prompts found. Please call generate-prompts first.' }, { status: 400 })
    }

    if (force) {
      console.log('[KEYFRAMES-IMAGE] force=true, clearing old assets')
      await prisma.asset.deleteMany({
        where: { projectId: params.id, step: { stepType: 'KEYFRAMES' } }
      })
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: 'PENDING' as any, outputData: existingOutput, errorMessage: null },
      })
    }

    await startStep(step.id)

    try {
      let styleRefUrl: string
      let selectedStylePrompt: string
      try {
        const ref = await getStyleRefUrl(params.id)
        styleRefUrl = ref.styleRefUrl
        selectedStylePrompt = ref.stylePrompt ||
          'cinematic film still, 35mm Kodak Portra 400, soft grain, atmospheric depth, 8K'
      } catch (refErr: any) {
        console.error('[KEYFRAMES-IMAGE] 风格图提取失败：', refErr?.message)
        return NextResponse.json(
          { error: 'STORAGE_001', message: refErr?.message || '未找到有效风格参考图 URL' },
          { status: 400 }
        )
      }

      const imageClient = await getImageClient()
      // 收集角色参考图（用于多图参考：风格图 + 角色图）
      const characterAssets = await prisma.asset.findMany({
        where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
      })
      const characterImageUrls = characterAssets
        .map((a) => a.url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
      const refs = await getProjectReferences(params.id).catch(() => [])
      const userRefUrls = refs.filter(r => r.url).map(r => r.url)
      const results = []

      for (const promptItem of prompts) {
        const lastResult = await imageClient.generateKeyframe(
          params.id,
          promptItem.englishPrompt,
          styleRefUrl,
          'last',
          aspectRatio,
          imageModel,
          characterImageUrls.length > 0 ? characterImageUrls : undefined,
          userRefUrls,
          promptItem.firstFrameUrl || undefined
        )
        const lastAsset = await prisma.asset.create({
          data: {
            projectId: params.id,
            stepId: step.id,
            type: 'IMAGE',
            mimeType: 'image/png',
            storageKey: `projects/${params.id}/keyframes/${promptItem.shotId}_last.png`,
            url: lastResult.url,
            metadata: {
              pairId: promptItem.shotId,
              frameType: 'last',
              sceneDesc: promptItem.chineseDesc,
              llmPrompt: promptItem.englishPrompt,
              aspectRatio,
            },
          }
        })

        results.push({
          shotId: promptItem.shotId,
          firstFrameUrl: promptItem.firstFrameUrl || '',
          lastFrameUrl: lastResult.url,
          description: promptItem.chineseDesc,
          actionChange: '',
        })
      }

      await completeStep(step.id, { results, keyframes: results, count: results.length, aspectRatio, imageModel: imageModel || 'gpt-image-2' })
      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[KEYFRAMES-IMAGE] 用户确认，开始生图，共 ${prompts.length} 条，比例 ${aspectRatio}，模型 ${imageModel || '默认'}`)
      return NextResponse.json({ success: true, data: { results, count: results.length } })
    } catch (e: any) {
      await failStep(step.id, e.message)
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === 默认兼容：无 action 时走原有完整流程 ===

  try {
    const imageClient = await getImageClient()
    const textClient = await getTextClient()

    // 获取选定的风格参考图 URL + 风格提示词
    let styleRefUrl: string
    let selectedStylePrompt: string
    try {
      const ref = await getStyleRefUrl(params.id)
      styleRefUrl = ref.styleRefUrl
      selectedStylePrompt = ref.stylePrompt ||
        'cinematic film still, 35mm Kodak Portra 400, soft grain, atmospheric depth, 8K'
      console.log('[KEYFRAMES-READ] 读取到 styleRefUrl 前80字符:', styleRefUrl.slice(0, 80))
    } catch (refErr: any) {
      console.error('[KEYFRAMES-READ] 校验失败：', refErr?.message)
      return NextResponse.json(
        { error: 'STORAGE_001', message: refErr?.message || '未找到有效风格参考图 URL' },
        { status: 400 }
      )
    }

    const results = []

    // 收集角色参考图（用于多图参考：风格图 + 角色图）
    const characterAssets = await prisma.asset.findMany({
      where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
    })
    const characterImageUrls = characterAssets
      .map((a) => a.url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
    const refs = await getProjectReferences(params.id).catch(() => [])
    const userRefUrls = refs.filter(r => r.url).map(r => r.url)
    const defaultRefLabels = refs.filter((r: any) => r.labels?.length).flatMap((r: any) => r.labels)
    const defaultRefHint = refs.length > 0
      ? `\n【参考图】${refs.length} 张用户参考图${defaultRefLabels.length > 0 ? `（标签：${defaultRefLabels.join('、')}）` : ''}。生成 imagePrompt 时可以直接引用参考图中的人物。`
      : ''

    for (const shot of shotsWithFirstFrame) {
      const lastPrompt = loadPromptTemplate('keyframe-last', {
        STYLE_REF: selectedStylePrompt,
        USER_INPUT: (shot.description || `${shot.shotId} - ${shot.sceneName}`) + defaultRefHint,
      })
      const lastPromptText = await textClient.generate(lastPrompt, { temperature: 0.7, maxTokens: 1024 })
      const parsedLast = extractJsonFromMarkdown(lastPromptText)
      const lastImagePrompt = parsedLast.keyframe?.imagePrompt || lastPromptText

      // Phase 4: 只生成尾帧（起始帧作为只读参考从分镜设计读取）
      const lastResult = await imageClient.generateKeyframe(
        params.id,
        lastImagePrompt,
        styleRefUrl,
        'last',
        undefined,
        undefined,
        characterImageUrls.length > 0 ? characterImageUrls : undefined,
        userRefUrls
      )
      const lastAsset = await prisma.asset.create({
        data: {
          projectId: params.id,
          stepId: step.id,
          type: 'IMAGE',
          mimeType: 'image/png',
          storageKey: `projects/${params.id}/keyframes/${shot.shotId}_last.png`,
          url: lastResult.url,
          metadata: { pairId: shot.shotId, frameType: 'last', sceneDesc: shot.description, llmPrompt: lastPromptText },
        }
      })

      results.push({
        shotId: shot.shotId,
        firstFrameUrl: shot.firstFrameUrl,  // Phase 4: 只读引用，来自分镜设计
        lastFrameUrl: lastResult.url,
        description: shot.description,
        actionChange: '',
      })
    }

    console.log(`[KEYFRAMES-xxx] 尾帧生成完成, 数量: ${results.length}`)
    await completeStep(step.id, { results, keyframes: results, count: results.length })
    return NextResponse.json({ success: true, data: { results, count: results.length } })
  } catch (e: any) {
    await failStep(step.id, e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'KEYFRAMES' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const outputData = (step.outputData as any) || {}
  const nextOutput: any = { ...outputData }

  // 支持 keyframes 数组保存（原有逻辑）
  if (Array.isArray(body.keyframes)) {
    nextOutput.keyframes = body.keyframes
    console.log(`[KEYFRAMES-PATCH] 保存 keyframes, 项目=${params.id}, 数量=${body.keyframes.length}`)
  }

  // 工作指令.txt（2026-05-24）：支持 prompts 数组保存（提示词行内编辑）
  if (Array.isArray(body.prompts)) {
    nextOutput.prompts = body.prompts
    console.log(`[TEXT-EDIT-KEYFRAMES] 保存 prompts 成功, 数量=${body.prompts.length}`)
  }

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: { outputData: nextOutput }
  })

  return NextResponse.json({ success: true })
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'KEYFRAMES' } },
    include: { resultAssets: true }
  })
  if (!step) return NextResponse.json({ status: 'not_found' })

  // Phase 4: 合并分镜设计的起始帧到输出数据
  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  const storyboardShots = (storyboardStep?.outputData as any)?.shots || []
  const shotFirstFrames: Record<string, string> = {}
  for (const s of storyboardShots) {
    if (s.firstFrameUrl) shotFirstFrames[s.shotId] = s.firstFrameUrl
  }

  const outputData = step.outputData as any || {}
  const keyframes = outputData.keyframes || outputData.results || []
  // 注入首帧引用
  const enrichedKeyframes = keyframes.map((kf: any) => ({
    ...kf,
    firstFrameUrl: kf.firstFrameUrl || shotFirstFrames[kf.shotId] || '',
  }))

  return NextResponse.json({
    status: step.status,
    outputData: { ...outputData, keyframes: enrichedKeyframes },
    assets: step.resultAssets,
  })
}
