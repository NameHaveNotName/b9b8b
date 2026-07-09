export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { getStyleRefUrl, getProjectReferences } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'
import { logOperation } from '@/lib/operations'
import { STEP_COSTS } from '@/lib/points-config'

/**
 * 生成概念图提示词（供 generate-prompts 和 generate-images 共用）
 * 成功返回 { prompts, totalScenes }，失败抛出异常（调用方需 catch 并 failStep）
 */
async function generateConceptPrompts(
  project: any,
  frameworkStep: any,
  stepId: string
): Promise<{ prompts: any[]; totalScenes: number }> {
  const framework = (project.framework || frameworkStep.outputData) as any
  const acts = Array.isArray(framework?.acts) ? framework.acts : []

  const prompt = loadPromptTemplate('concept', {
    USER_INPUT: JSON.stringify({ framework })
  })
  const textClient = await getTextClient()
  const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
  const parsed = extractJsonFromMarkdown(resultText)
  const parsedScenes = parsed.scenes || []

  const prompts: any[] = []
  for (const act of acts) {
    const actNo = act.actNo || act.actNumber || 1
    const keyScenes = Array.isArray(act.keyScenes) ? act.keyScenes : (Array.isArray(act.scenes) ? act.scenes : [])
    const sceneCount = Math.max(1, Math.min(keyScenes.length || 1, 3))
    for (let i = 0; i < sceneCount; i++) {
      const sceneDesc = keyScenes[i] || `幕${actNo}场景${i + 1}`
      const llmScene = parsedScenes.find(
        (s: any) => s.actNumber === actNo && s.sceneNumber === i + 1
      )
      // 过滤空白，确保 englishPrompt 是有效的英文内容
        const rawPrompt = llmScene?.imagePrompt || ''
        const isValidEnglish = rawPrompt.trim().length > 5 && /[a-zA-Z]{3,}/.test(rawPrompt)
        const imagePrompt = isValidEnglish
          ? rawPrompt.trim()
          : `Cinematic scene, ${sceneDesc}. Film still, 35mm Kodak Portra 400, atmospheric depth, 8k, poetic realism.`
        prompts.push({
        id: `prompt_act${actNo}_scene${i + 1}`,
        chineseDesc: sceneDesc,
        englishPrompt: imagePrompt,
        target: `concept_act${actNo}_scene${i + 1}`,
        actNumber: actNo,
        sceneIndex: i,
      })
    }
  }

  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
  await prisma.workflowStep.update({
    where: { id: stepId },
    data: {
      status: 'PENDING' as any,
      outputData: {
        ...(step?.outputData as any || {}),
        prompts,
        totalScenes: prompts.length,
      },
    },
  })

  console.log(`[CONCEPT-PROMPT] 生成 ${prompts.length} 条提示词`)
  return { prompts, totalScenes: prompts.length }
}

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

  if (!await canExecuteStep(params.id, 'CONCEPT')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  const frameworkStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
  })
  if (!frameworkStep || frameworkStep.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'WORKFLOW_003' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  // 支持整体重做：force=true 时跳过缓存检查
  const body = await req.json().catch(() => ({}))
  const force = body?.force === true
  const action: 'generate-prompts' | 'generate-images' = body?.action || 'generate-images'

  // === generate-prompts: 只生成提示词，不生图 ===
  if (action === 'generate-prompts') {
    try {
      console.log('[CONCEPT-PROMPT] 收到 generate-prompts 请求')
      const { prompts } = await generateConceptPrompts(project, frameworkStep, step.id)
      return NextResponse.json({ success: true, status: 'PROMPT_READY', prompts })
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || /aborted|timeout|timed out/i.test(e?.message || '')
      const errorMessage = isAbort
        ? '提示词生成超时（模型响应较慢），请稍后重试'
        : e.message
      console.error(`[CONCEPT-PROMPT] 失败: ${errorMessage}`, e?.stack?.slice(0, 300))
      await failStep(step.id, errorMessage)
      return NextResponse.json({ error: 'API_001', message: errorMessage }, { status: 500 })
    }
  }

  // === generate-images: 读取已保存提示词，waitUntil 后台流式生成 ===
  if (action === 'generate-images') {
    const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

    const aspectRatio = body?.aspectRatio || '16:9'
    const imageModel = body?.imageModel
    console.log(`[ASPECT-RATIO] [CONCEPT-IMAGE] 用户选择比例: ${aspectRatio}`)
    console.log(`[MODEL-SELECT] [CONCEPT-IMAGE] 用户选择模型: ${imageModel || '默认'}`)

    const existingOutput = (step.outputData as any) || {}
    const prompts = existingOutput.prompts || []
    console.log('[CONCEPT-IMAGE] existingOutput keys:', Object.keys(existingOutput))
    console.log('[CONCEPT-IMAGE] prompts count:', prompts.length)

    // 工作指令.txt（2026-06-07）：prompts 为空时自动触发提示词生成，不返回 400
    let resolvedPrompts = prompts
    if (resolvedPrompts.length === 0) {
      console.warn('[CONCEPT-IMAGE] No prompts found, auto-triggering prompt generation')
      try {
        const generated = await generateConceptPrompts(project, frameworkStep, step.id)
        resolvedPrompts = generated.prompts
        console.log(`[CONCEPT-IMAGE] Auto-generated ${resolvedPrompts.length} prompts, continuing to image generation`)
      } catch (promptErr: any) {
        const isAbort = promptErr?.name === 'AbortError' || /aborted|timeout|timed out/i.test(promptErr?.message || '')
        const errorMessage = isAbort
          ? '提示词生成超时（模型响应较慢），请稍后重试'
          : promptErr.message
        console.error(`[CONCEPT-IMAGE] Auto-prompt generation failed: ${errorMessage}`, promptErr?.stack?.slice(0, 300))
        await failStep(step.id, errorMessage)
        return NextResponse.json({ error: 'API_001', message: errorMessage }, { status: 500 })
      }
    }

    // force=true 时清空旧资产（必须重新读取最新 outputData，避免覆盖自动生成的 prompts）
    if (force) {
      console.log('[CONCEPT-IMAGE] force=true, clearing old assets')
      await prisma.asset.deleteMany({
        where: { projectId: params.id, step: { stepType: 'CONCEPT' } }
      })
      const latestStep = await prisma.workflowStep.findUnique({ where: { id: step.id } })
      const latestOutput = (latestStep?.outputData as any) || existingOutput
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: 'PENDING' as any, outputData: latestOutput, errorMessage: null },
      })
    }

    await startStep(step.id)

    try {
      let styleRefUrl: string
      let stylePrompt: string
      try {
        const ref = await getStyleRefUrl(params.id)
        styleRefUrl = ref.styleRefUrl
        stylePrompt = ref.stylePrompt
      } catch (refErr: any) {
        console.error('[CONCEPT-IMAGE] 风格图提取失败：', refErr?.message)
        return NextResponse.json(
          { error: 'STORAGE_001', message: refErr?.message || '未找到有效风格参考图 URL' },
          { status: 400 }
        )
      }

      const characterAssets = await prisma.asset.findMany({
        where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
      })
      const characterImageUrls = characterAssets
        .map((a) => a.url)
        .filter((u) => typeof u === 'string' && u.length > 0) as string[]
      const characterDescs = characterAssets
        .map((a) => ({
          name: (a.metadata as any)?.characterName || '',
          description:
            (a.metadata as any)?.chineseDesc ||
            (a.metadata as any)?.llmPrompt ||
            '',
        }))
        .filter((c) => c.name) as Array<{ name: string; description: string }>

      const refs = await getProjectReferences(params.id).catch(() => [])
      const userRefUrls = refs.filter(r => r.url).map(r => r.url)

      const imageClient = await getImageClient()
      const scenes = []
      const failedScenes: string[] = []

      for (const promptItem of resolvedPrompts) {
        try {
          const result = await imageClient.generateConceptScene(
            params.id,
            promptItem.englishPrompt,
            styleRefUrl,
            stylePrompt,
            characterImageUrls,
            undefined,
            aspectRatio,
            imageModel,
            characterDescs,
            userRefUrls
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
                sceneIndex: promptItem.sceneIndex,
                llmPrompt: promptItem.englishPrompt,
                prompt: promptItem.englishPrompt,
                aspectRatio,
                imageModel: imageModel || 'gpt-image-2',
              },
            },
          })
          scenes.push({
            actNumber: promptItem.actNumber,
            sceneIndex: promptItem.sceneIndex,
            assetId: asset.id,
            url: result.url,
            prompt: promptItem.englishPrompt,
            aspectRatio,
            isMock: !!result.metadata?.isMock,
            mockReason: result.metadata?.mockReason || null,
          })
        } catch (imgErr: any) {
          const sceneLabel = `幕${promptItem.actNumber}-场景${promptItem.sceneIndex + 1}`
          console.error(`[CONCEPT-IMAGE] ${sceneLabel} 生图失败:`, imgErr?.message)
          failedScenes.push(sceneLabel)
        }
      }

      if (scenes.length === 0) {
        const errMsg = `所有概念图生图均失败${failedScenes.length > 0 ? '（' + failedScenes.join(', ') + '）' : ''}`
        await failStep(step.id, errMsg)
        await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: errMsg })
        return NextResponse.json({ error: 'API_001', message: errMsg }, { status: 500 })
      }

      await completeStep(step.id, { scenes, totalScenes: scenes.length, imageModel: imageModel || 'gpt-image-2', aspectRatio })
      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[CONCEPT-IMAGE] 完成: 成功 ${scenes.length}/${resolvedPrompts.length} 条，失败: ${failedScenes.join(', ') || '无'}`)
      return NextResponse.json({ success: true, data: { scenes, totalScenes: scenes.length } })
    } catch (e: any) {
      await failStep(step.id, e.message)
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === 默认兼容：无 action 时走原有完整流程 ===
  if (!force && step.status === 'COMPLETED' && step.outputData) {
    console.log('[CONCEPT] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  // 整体重做：重置状态
  if (force) {
    console.log('[CONCEPT] force=true, clearing old assets')
    await prisma.asset.deleteMany({
      where: { projectId: params.id, step: { stepType: 'CONCEPT' } }
    })
    const existingOutput = (step.outputData as any) || {}
    const preservedOutput = {
      prompts: existingOutput.prompts,
      totalScenes: existingOutput.totalScenes,
    }
    console.log('[CONCEPT] force=true, preserved prompts count:', existingOutput.prompts?.length || 0)
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PENDING' as any, outputData: preservedOutput, errorMessage: null },
    })
  }

  await startStep(step.id)

  try {
    const framework = (project.framework || frameworkStep.outputData) as any
    const acts = Array.isArray(framework?.acts) ? framework.acts : []
    const synopsis: string = framework?.synopsis || ''

    // 获取风格参考图 URL + 风格提示词
    // 工作指令.txt（Round 5 修复 #3）：统一调用 getStyleRefUrl 公共函数；
    // 之前按 Asset.metadata.styleId 反查的逻辑与 PATCH 写入的 step.outputData 脱节，是概念图 STORAGE_001 的根因
    let styleRefUrl: string
    let stylePrompt: string
    try {
      const ref = await getStyleRefUrl(params.id)
      styleRefUrl = ref.styleRefUrl
      stylePrompt = ref.stylePrompt
      console.log('[CONCEPT-READ] 读取到 styleRefUrl 前80字符:', styleRefUrl.slice(0, 80))
    } catch (refErr: any) {
      console.error('[CONCEPT-READ] 校验失败：', refErr?.message)
      return NextResponse.json(
        { error: 'STORAGE_001', message: refErr?.message || '未找到有效风格参考图 URL' },
        { status: 400 }
      )
    }

    const characterAssets = await prisma.asset.findMany({
      where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
    })
    const characterRefs = characterAssets
      .map((a) => (a.metadata as any)?.characterId)
      .filter(Boolean) as string[]

    // 工作指令.txt（Round 6 任务一）：收集所有角色图 URL，用于概念图多图参考。
    // xiaomi.ts 内部会过滤非 http(s)（data: URL 不能传给豆包多图模型）。
    const characterImageUrls = characterAssets
      .map((a) => a.url)
      .filter((u) => typeof u === 'string' && u.length > 0) as string[]
    console.log(
      `[CONCEPT-READ] 角色图数量: ${characterImageUrls.length}, http(s) 数量: ${characterImageUrls.filter((u) => /^https?:\/\//i.test(u)).length}`
    )

    const refs = await getProjectReferences(params.id).catch(() => [])
    const userRefUrls = refs.filter(r => r.url).map(r => r.url)

    // 1. 用文本模板生成概念图提示词
    const prompt = loadPromptTemplate('concept', {
      USER_INPUT: JSON.stringify({ framework, selectedStyle: stylePrompt })
    })
    const textClient = await getTextClient()
    const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
    const parsed = extractJsonFromMarkdown(resultText)
    const parsedScenes = parsed.scenes || []

    // 2. 用图像 API 生成概念图
    const imageClient = await getImageClient()
    const scenes = []
    const failedScenes: string[] = []

    for (const act of acts) {
      const actNo = act.actNo || act.actNumber || 1
      const keyScenes = Array.isArray(act.keyScenes) ? act.keyScenes : (Array.isArray(act.scenes) ? act.scenes : [])
      // 每幕概念图数量：基于 keyScenes 数量，至少1张，最多3张
      const sceneCount = Math.max(1, Math.min(keyScenes.length || 1, 3))

      for (let i = 0; i < sceneCount; i++) {
        try {
          const sceneDesc = keyScenes[i] || `幕${actNo}场景${i + 1}`
          // 优先使用 LLM 生成的 imagePrompt
          const llmScene = parsedScenes.find(
            (s: any) => s.actNumber === actNo && s.sceneNumber === i + 1
          )
          const rawPrompt = llmScene?.imagePrompt || ''
          const isValidEnglish = rawPrompt.trim().length > 5 && /[a-zA-Z]{3,}/.test(rawPrompt)
          const finalPrompt = isValidEnglish
            ? rawPrompt.trim()
            : `Cinematic scene, ${sceneDesc}. Film still, 35mm Kodak Portra 400, atmospheric depth, 8k, poetic realism.`

          // 工作指令.txt（Round 6 任务一）：多图参考 — 风格图 + 全部角色图
          const result = await imageClient.generateConceptScene(
            params.id,
            finalPrompt,
            styleRefUrl,
            stylePrompt,
            characterImageUrls,
            undefined,
            undefined,
            undefined,
            undefined,
            userRefUrls
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
                actNumber: actNo,
                sceneIndex: i,
                llmPrompt: llmScene?.imagePrompt,
                prompt: finalPrompt,
                size: '1024x576',
                aspectRatio: '16:9',
                imageModel: IMAGE_MODELS.primary,
              },
            },
          })
          scenes.push({
            actNumber: actNo,
            sceneIndex: i,
            assetId: asset.id,
            url: result.url,
            prompt: finalPrompt,
            size: '1024x576',
            isMock: !!result.metadata?.isMock,
            mockReason: result.metadata?.mockReason || null,
          })
        } catch (imgErr: any) {
          const sceneLabel = `幕${actNo}-场景${i + 1}`
          console.error(`[CONCEPT] ${sceneLabel} 生图失败:`, imgErr?.message)
          failedScenes.push(sceneLabel)
        }
      }
    }

    if (scenes.length === 0) {
      const errMsg = `所有概念图生图均失败${failedScenes.length > 0 ? '（' + failedScenes.join(', ') + '）' : ''}`
      await failStep(step.id, errMsg)
      await logOperation({
        userId,
        projectId: params.id,
        workflowStepId: step.id,
        actionType: 'generate',
        cost: 0,
        status: 'failed',
        metadata: { error: errMsg },
      })
      return NextResponse.json({ error: 'API_001', message: errMsg }, { status: 500 })
    }

    await completeStep(step.id, { scenes, totalScenes: scenes.length })
    await logOperation({
      userId,
      projectId: params.id,
      workflowStepId: step.id,
      actionType: 'generate',
      cost: STEP_COSTS.concept,
      status: 'success',
    })
    return NextResponse.json({ success: true, data: { scenes, totalScenes: scenes.length } })
  } catch (e: any) {
    await failStep(step.id, e.message)
    await logOperation({
      userId,
      projectId: params.id,
      workflowStepId: step.id,
      actionType: 'generate',
      cost: 0,
      status: 'failed',
      metadata: { error: e.message },
    })
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

// 工作指令.txt（2026-05-24）：文本编辑 PATCH，保存用户编辑后的 prompts
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
  const { prompts } = body

  if (!Array.isArray(prompts)) {
    return NextResponse.json({ error: 'VALIDATION_001', message: 'prompts 必须是数组' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const existingOutput = (step.outputData as any) || {}
  const nextOutput = { ...existingOutput, prompts }

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: { outputData: nextOutput }
  })

  console.log('[TEXT-EDIT-CONCEPT] 保存 prompts 成功, 数量:', prompts.length)
  return NextResponse.json({ success: true })
}
