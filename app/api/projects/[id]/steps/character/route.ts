export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { IMAGE_MODELS, getPromptLanguageInstruction, getModelPromptLanguage } from '@/lib/models-config'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { claimStepForGeneration, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { getProjectDefaultAspectRatio } from '@/lib/server/workflow-state'
import { getStyleRefUrl } from '@/lib/style-ref'
import { checkPoints, deductPointsAndLog, refundPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS, calculateBatchCost } from '@/lib/points-config'
import { getBoundReferences } from '@/lib/asset-bindings'
import { buildVisualStyleLayers, getGeneratableCharacters } from '@/lib/character-generation-policy'
import { resolveVisualTextRoute, type ResolvedVisualTextRoute } from '@/lib/visual-text-routing-server'

/**
 * 把 LLM 返回的角色 imagePrompt 组装为 prompts 条目。
 * 语言校验按目标模型：中文优化模型要求中文字符，英文偏好模型要求拉丁字母；
 * 校验不过时回退到对应语言的中性描述（不再硬编码胶片型号词）。
 */
function buildCharacterPromptEntries(parsedChars: any[], characters: any[], imageModel?: string, referenceAssignments: Record<string, any[]> = {}) {
  const isZh = getModelPromptLanguage(imageModel || IMAGE_MODELS.primary) === 'zh'
  return characters.map((character, i) => {
    const charData = parsedChars.find((c: any) => c.characterId === character.id || c.name === character.name)
    const charDesc = charData?.description || character.description || `${character.name}（${character.role}）`
    const rawPrompt = charData?.imagePrompt || ''
    const isValidPrompt = isZh
      ? rawPrompt.trim().length > 10 && /[一-鿿]{2,}/.test(rawPrompt)
      : rawPrompt.trim().length > 10 && /[a-zA-Z]{3,}/.test(rawPrompt)
    const fallbackPrompt = isZh
      ? `电影感角色母版肖像：${character.name}，${charDesc}。单人正面或四分之三视角，面部五官与服装完整清晰可见，干净简洁背景，均匀可读受光，画面无文字无水印。`
      : `Cinematic character portrait of ${character.name}, ${charDesc}. Solo portrait, front-facing, complete full face clearly visible. Clean minimal background, clear key lighting, no text or watermark.`
    const imagePrompt = isValidPrompt ? rawPrompt.trim() : fallbackPrompt
    return {
      id: `prompt_${i + 1}`,
      chineseDesc: charDesc,
      englishPrompt: imagePrompt,
      target: `character_${character.id}`,
      characterName: character.name,
      characterId: character.id,
      role: character.role,
      entityType: character.entityType,
      visualIdentity: character.visualIdentity || '',
      referenceAssignments: (referenceAssignments[character.id] || []).map((reference: any) => ({
        id: reference.assetId || reference.id,
        title: reference.title || '角色身份参考',
        role: reference.referenceRole || 'IDENTITY',
      })),
    }
  })
}

/**
 * 生成角色提示词（供 generate-prompts 和 generate-images 共用）
 * 成功返回 { prompts, characterCount }，失败抛出异常（调用方需 catch 并 failStep）
 */
async function generateCharacterPrompts(
  project: any,
  frameworkStep: any,
  stepId: string,
  imageModel?: string,
  textModel?: string,
  routing?: ResolvedVisualTextRoute,
): Promise<{ prompts: any[]; characterCount: number }> {
  const framework = (project.framework || frameworkStep.outputData) as any
  const characters = getGeneratableCharacters(framework, 5)

  const assignmentEntries = await Promise.all(characters.map(async (character: any) => [
    character.id,
    (await getBoundReferences(project.id, 'CHARACTER', character.id).catch(() => []))
      .filter((reference: any) => reference.referenceRole === 'IDENTITY'),
  ] as const))
  const referenceAssignments = Object.fromEntries(assignmentEntries)
  const referenceLines = characters.map((character: any) => {
    const assigned = referenceAssignments[character.id] || []
    return assigned.length > 0
      ? `- ${character.name}（${character.id}）：已绑定 ${assigned.length} 张身份参考，只能用于这个角色；${assigned.map((item: any) => item.title).join('、')}`
      : `- ${character.name}（${character.id}）：没有身份参考，必须只按文字新设计，不得复制其他参考图中的人物、吉祥物或物种。`
  })
  const styleLayers = buildVisualStyleLayers(framework)
  const refInstructions = `【参考图职责边界】\n${referenceLines.join('\n')}\n` +
    `身份参考只能约束绑定角色；画风参考只能约束媒介、线条、色彩与光影，绝不能把其中人物的脸、服装或物种复制给其他角色。\n` +
    `【风格三层】环境：${styleLayers.environment || '未指定'}；角色渲染：${styleLayers.characterRendering || '未指定'}；合成：${styleLayers.compositing || '未指定'}。`

  const prompt = loadPromptTemplate('character', {
    USER_INPUT: JSON.stringify(framework),
    REFERENCE_INSTRUCTIONS: refInstructions,
    LANGUAGE_INSTRUCTION: getPromptLanguageInstruction(imageModel || IMAGE_MODELS.primary),
  })
  const textClient = await getTextClient()
  const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096, model: routing?.model || textModel })
  const parsed = extractJsonFromMarkdown(resultText)
  const parsedChars = parsed.characters || []

  const prompts = buildCharacterPromptEntries(parsedChars, characters, imageModel, referenceAssignments)

  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
  await prisma.workflowStep.update({
    where: { id: stepId },
    data: {
      status: 'PENDING' as any,
      outputData: {
        ...(step?.outputData as any || {}),
        prompts,
        characterCount: characters.length,
        textRoutingMode: routing?.mode,
        textRoutingSnapshot: routing?.snapshot || undefined,
        textModel: routing?.legacyModel || textModel,
      },
    },
  })

  console.log(`[CHARACTER-PROMPT] 生成 ${prompts.length} 条提示词`)
  return { prompts, characterCount: characters.length }
}

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const access = await checkProjectPermission(params.id, undefined, { mode: 'EDIT_STEP', stepType: 'CHARACTER' })
  if (!access.allowed) {
    return access.response
  }

  if (!(await canExecuteStep(params.id, 'CHARACTER'))) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  const frameworkStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
  })
  if (!frameworkStep || frameworkStep.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'WORKFLOW_003' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CHARACTER' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const body = await _req.json().catch(() => ({}))
  const force = body?.force === true
  const action: 'generate-prompts' | 'generate-images' = body?.action || 'generate-images'

  // === generate-prompts: 只生成提示词，不生图 ===
  if (action === 'generate-prompts') {
    const promptPointsCheck = await checkPoints(GENERATION_COSTS.DEFAULT, params.id, 'generation.character_prompts', 'TEXT')
    if (!promptPointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

    try {
      console.log('[CHARACTER-PROMPT] 收到 generate-prompts 请求')
      const promptImageModel = body?.imageModel || (step.outputData as any)?.imageModel || IMAGE_MODELS.primary
      const routing = await resolveVisualTextRoute(project, body, 'character-prompt')
      const { prompts } = await generateCharacterPrompts(project, frameworkStep, step.id, promptImageModel, body.textModel, routing)
      await deductPointsAndLog(userId, promptPointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      return NextResponse.json({ success: true, status: 'PROMPT_READY', prompts })
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || /aborted|timeout|timed out/i.test(e?.message || '')
      const errorMessage = isAbort
        ? '提示词生成超时（模型响应较慢），请稍后重试'
        : e.message
      console.error(`[CHARACTER-PROMPT] 失败: ${errorMessage}`, e?.stack?.slice(0, 300))
      await failStep(step.id, errorMessage)
      await deductPointsAndLog(userId, promptPointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage })
      return NextResponse.json({ error: 'API_001', message: errorMessage }, { status: 500 })
    }
  }

  // === generate-images: 读取已保存提示词，执行生图 ===
  if (action === 'generate-images') {
    const defaultAspectRatio = await getProjectDefaultAspectRatio(params.id)
    const aspectRatio = body?.aspectRatio || defaultAspectRatio
    const imageModel = body?.imageModel
    console.log(`[ASPECT-RATIO] [CHARACTER-IMAGE] 用户选择比例: ${aspectRatio}`)
    console.log(`[MODEL-SELECT] [CHARACTER-IMAGE] 用户选择模型: ${imageModel || '默认'}`)

    const existingOutput = (step.outputData as any) || {}
    const storedPrompts = existingOutput.prompts || []
    const currentFramework = (project.framework || frameworkStep.outputData) as any
    const allowedCharacterIds = new Set(getGeneratableCharacters(currentFramework, 5).map((character: any) => character.id))
    const prompts = storedPrompts.filter((prompt: any) => allowedCharacterIds.has(prompt.characterId))
    console.log('[CHARACTER-IMAGE] existingOutput keys:', Object.keys(existingOutput))
    console.log('[CHARACTER-IMAGE] prompts count:', prompts.length)

    // 工作指令.txt（2026-06-07）：prompts 为空时自动触发提示词生成，不返回 400
    let resolvedPrompts = prompts
    if (resolvedPrompts.length === 0) {
      console.warn('[CHARACTER-IMAGE] No prompts found, auto-triggering prompt generation')
      const promptPointsCheck = await checkPoints(GENERATION_COSTS.DEFAULT, params.id, 'generation.character_prompts', 'TEXT')
      if (!promptPointsCheck.ok) {
        return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
      }
      try {
        const routing = await resolveVisualTextRoute(project, body, 'character-prompt')
        const generated = await generateCharacterPrompts(project, frameworkStep, step.id, imageModel, body.textModel, routing)
        resolvedPrompts = generated.prompts
        console.log(`[CHARACTER-IMAGE] Auto-generated ${resolvedPrompts.length} prompts, continuing to image generation`)
        await deductPointsAndLog(userId, promptPointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      } catch (promptErr: any) {
        const isAbort = promptErr?.name === 'AbortError' || /aborted|timeout|timed out/i.test(promptErr?.message || '')
        const errorMessage = isAbort
          ? '提示词生成超时（模型响应较慢），请稍后重试'
          : promptErr.message
        console.error(`[CHARACTER-IMAGE] Auto-prompt generation failed: ${errorMessage}`, promptErr?.stack?.slice(0, 300))
        await failStep(step.id, errorMessage)
        await deductPointsAndLog(userId, promptPointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage })
        return NextResponse.json({ error: 'API_001', message: errorMessage }, { status: 500 })
      }
    }

    const imageCost = calculateBatchCost(GENERATION_COSTS.CHARACTER_DESIGN, resolvedPrompts.length)
    const pointsCheck = await checkPoints(imageCost, params.id, 'generation.character_design', 'IMAGE')
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

    // force=true 时清空旧资产（必须重新读取最新 outputData，避免覆盖自动生成的 prompts）
    if (force) {
      console.log('[CHARACTER-IMAGE] force=true, clearing old assets')
      await prisma.asset.deleteMany({
        where: { projectId: params.id, step: { stepType: 'CHARACTER' } }
      })
      const latestStep = await prisma.workflowStep.findUnique({ where: { id: step.id } })
      const latestOutput = (latestStep?.outputData as any) || existingOutput
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: 'PENDING' as any, outputData: latestOutput, errorMessage: null },
      })
    }

    // 异步任务先原子预扣一次；后台全部失败时退回同一付款账户。
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', {
      projectId: params.id,
      workflowStepId: step.id,
      success: true,
    })
    if (!(await claimStepForGeneration(step.id))) {
      return NextResponse.json(
        { success: true, status: 'PROCESSING', alreadyRunning: true, message: '该步骤的生成任务已在进行中，请等待当前任务完成' },
      )
    }

    // 异步后台生成：HTTP 立即返回，避免前端因生图耗时而超时
    waitUntil(
      (async () => {
        try {
          await generateCharacterImagesBackground(
            params.id,
            step.id,
            resolvedPrompts,
            aspectRatio,
            imageModel,
            pointsCheck.cost,
            userId,
            pointsCheck.billingSource,
            pointsCheck.billingGroupId,
          )
        } catch (e: any) {
          console.error('[CHARACTER-IMAGE] 后台生成异常:', e?.message)
        }
      })()
    )

    return NextResponse.json({
      success: true,
      status: 'PROCESSING',
      message: '角色设计生成任务已在后台启动，请稍后刷新查看',
    })
  }

  // === 默认兼容：无 action 时走原有完整流程 ===
  if (!force && step.status === 'COMPLETED' && step.outputData) {
    console.log('[CHARACTER] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  if (force) {
    console.log('[CHARACTER] force=true, clearing old assets')
    await prisma.asset.deleteMany({
      where: { projectId: params.id, step: { stepType: 'CHARACTER' } }
    })
    const existingOutput = (step.outputData as any) || {}
    const preservedOutput = {
      prompts: existingOutput.prompts,
      characterCount: existingOutput.characterCount,
    }
    console.log('[CHARACTER] force=true, preserved prompts count:', existingOutput.prompts?.length || 0)
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PENDING' as any, outputData: preservedOutput, errorMessage: null },
    })
  }

  const frameworkForBilling = (project.framework || frameworkStep.outputData) as any
  const characterCountForBilling = getGeneratableCharacters(frameworkForBilling, 5).length
  const totalCost = GENERATION_COSTS.DEFAULT + calculateBatchCost(GENERATION_COSTS.CHARACTER_DESIGN, characterCountForBilling)
  const pointsCheck = await checkPoints(totalCost, params.id, 'generation.character_design', 'IMAGE')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  const defaultAspectRatio = await getProjectDefaultAspectRatio(params.id)
  // 默认兼容流程同样只预扣一次，避免请求返回和后台完成各扣一次。
  await deductPointsAndLog(userId, pointsCheck.cost, 'generate', {
    projectId: params.id,
    workflowStepId: step.id,
    success: true,
  })
  if (!(await claimStepForGeneration(step.id))) {
    return NextResponse.json(
      { success: true, status: 'PROCESSING', alreadyRunning: true, message: '该步骤的生成任务已在进行中，请等待当前任务完成' },
    )
  }

  // 异步后台生成：先生成 prompts，再串行生图
  waitUntil(
    (async () => {
      try {
        const framework = (project.framework || frameworkStep.outputData) as any
        const characters = getGeneratableCharacters(framework, 5)

        const promptImageModel = body?.imageModel || (step.outputData as any)?.imageModel || IMAGE_MODELS.primary
        const prompt = loadPromptTemplate('character', {
          USER_INPUT: JSON.stringify(framework),
          REFERENCE_INSTRUCTIONS: '',
          LANGUAGE_INSTRUCTION: getPromptLanguageInstruction(promptImageModel),
        })
        const textClient = await getTextClient()
        const routingCompat = await resolveVisualTextRoute(project, body, 'character-prompt')
        const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096, model: routingCompat.model })
        const parsed = extractJsonFromMarkdown(resultText)
        const parsedChars = parsed.characters || []

        const prompts = buildCharacterPromptEntries(parsedChars, characters, promptImageModel)

        await prisma.workflowStep.update({
          where: { id: step.id },
          data: {
            outputData: {
              ...(step.outputData as any || {}),
              prompts,
              characterCount: characters.length,
              textRoutingMode: routingCompat.mode,
              textRoutingSnapshot: routingCompat.snapshot || undefined,
              textModel: routingCompat.legacyModel,
            },
          },
        })

        await generateCharacterImagesBackground(
          params.id,
          step.id,
          prompts,
          defaultAspectRatio,
          undefined,
          pointsCheck.cost,
          userId,
          pointsCheck.billingSource,
          pointsCheck.billingGroupId,
        )
      } catch (e: any) {
        console.error('[CHARACTER] 后台生成异常:', e?.message)
        await failStep(step.id, e.message)
        await refundPointsAndLog(userId, pointsCheck.cost, {
          projectId: params.id,
          workflowStepId: step.id,
          billingSource: pointsCheck.billingSource,
          billingGroupId: pointsCheck.billingGroupId,
          errorMessage: e.message,
        })
      }
    })()
  )

  return NextResponse.json({
    success: true,
    status: 'PROCESSING',
    message: '角色设计生成任务已在后台启动，请稍后刷新查看',
  })
}

/**
 * 后台实际执行角色生图。
 * 被 waitUntil 调用，HTTP 响应已经返回给前端。
 */
async function generateCharacterImagesBackground(
  projectId: string,
  stepId: string,
  resolvedPrompts: any[],
  aspectRatio: string,
  imageModel: string | undefined,
  cost: number,
  userId: string,
  billingSource: 'USER' | 'GROUP',
  billingGroupId: string | null,
) {
  try {
    const styleStep = await prisma.workflowStep.findFirst({
      where: { projectId, stepType: 'STYLE', status: 'COMPLETED' },
    })

    let styleRefUrl: string | undefined
    let stylePrompt: string | undefined
    if (styleStep) {
      try {
        const ref = await getStyleRefUrl(projectId)
        styleRefUrl = ref.styleRefUrl
        stylePrompt = ref.stylePrompt
        console.log(`[CHARACTER-BG] 注入风格图: ${styleRefUrl}`)
      } catch (refErr: any) {
        console.log(`[CHARACTER-BG] 风格图提取失败，回退到无风格模式`)
      }
    }

    const imageClient = await getImageClient()
    const portraits: any[] = []
    const failedCharacters: string[] = []
    const mockCharacters: string[] = []

    for (const promptItem of resolvedPrompts) {
      try {
        const priorityReferences = (await getBoundReferences(projectId, 'CHARACTER', promptItem.characterId).catch(() => []))
          .filter((reference: any) => reference.referenceRole === 'IDENTITY')
        const priorityReferenceUrls = priorityReferences.map((reference) => reference.url).filter(Boolean)
        const enrichedCharacter = {
          id: promptItem.characterId,
          name: promptItem.characterName,
          role: promptItem.role || '',
          entityType: promptItem.entityType || 'HUMAN',
          description: promptItem.englishPrompt || promptItem.chineseDesc,
        }

        const result = await imageClient.generateCharacterPortrait(
          projectId,
          enrichedCharacter,
          styleRefUrl,
          stylePrompt,
          aspectRatio,
          imageModel,
          [],
          priorityReferenceUrls
        )
        if (!result?.url || !result?.storageKey) {
          console.error(`[CHARACTER-BG] 角色 ${promptItem.characterName} 返回结果缺少 url/storageKey:`, JSON.stringify(result))
          failedCharacters.push(promptItem.characterName)
          continue
        }
        const asset = await prisma.asset.create({
          data: {
            projectId,
            createdById: userId,
            stepId,
            type: 'IMAGE',
            mimeType: 'image/png',
            storageKey: result.storageKey,
            url: result.url,
            metadata: {
              characterId: promptItem.characterId,
              characterName: promptItem.characterName,
              chineseDesc: promptItem.chineseDesc,
              styleRefUrl: styleRefUrl || null,
              llmPrompt: promptItem.englishPrompt,
              aspectRatio,
              imageModel: imageModel || IMAGE_MODELS.primary,
              quality: 'medium',
              isMock: !!result.isMock,
              ...(result.lastError ? { mockReason: result.lastError } : {}),
            },
          },
        })
        console.log(`[CHARACTER-BG] Asset 创建成功: assetId=${asset.id}, char=${promptItem.characterName}`)
        portraits.push({ character: enrichedCharacter, assetId: asset.id, url: result.url, llmPrompt: promptItem.englishPrompt })
        // 真实模型全失败时供应商回退到占位图，产出不可用，按未计费处理
        if (result.isMock) {
          mockCharacters.push(promptItem.characterName)
          console.warn(`[CHARACTER-BG] 角色 ${promptItem.characterName} 返回 Mock 占位图: ${result.lastError || '未知原因'}`)
        }
      } catch (imgErr: any) {
        console.error(`[CHARACTER-BG] 角色 ${promptItem.characterName} 生图失败:`, imgErr?.message)
        failedCharacters.push(promptItem.characterName)
      }
    }

    if (portraits.length === 0) {
      const errMsg = `所有角色生图均失败${failedCharacters.length > 0 ? '（' + failedCharacters.join(', ') + '）' : ''}`
      await failStep(stepId, errMsg)
      await refundPointsAndLog(userId, cost, {
        projectId,
        workflowStepId: stepId,
        billingSource,
        billingGroupId,
        errorMessage: errMsg,
      })
      return
    }

    await completeStep(stepId, { portraits, characterCount: portraits.length, imageModel: imageModel || IMAGE_MODELS.primary, aspectRatio })
    // 失败与 Mock 占位都不算有效产出，统一按条数退款
    const unbilledCount = failedCharacters.length + mockCharacters.length
    if (unbilledCount > 0) {
      await refundPointsAndLog(userId, calculateBatchCost(GENERATION_COSTS.CHARACTER_DESIGN, unbilledCount), {
        projectId,
        workflowStepId: stepId,
        billingSource,
        billingGroupId,
        finalStatus: 'PARTIAL',
        errorMessage: mockCharacters.length > 0
          ? `${unbilledCount}/${resolvedPrompts.length} 个角色未使用 AI 模型生成（${failedCharacters.length} 个失败、${mockCharacters.length} 个回退为占位图），对应点数已退回`
          : `${unbilledCount}/${resolvedPrompts.length} 个角色图片生成失败，失败部分点数已退回`,
      })
    }
    const dbAssetCount = await prisma.asset.count({ where: { stepId } })
    console.log(`[CHARACTER-BG] 完成: 成功 ${portraits.length}/${resolvedPrompts.length} 条，数据库 Asset 数: ${dbAssetCount}`)
  } catch (e: any) {
    console.error('[CHARACTER-BG] 异常:', e?.message)
    await failStep(stepId, e.message)
    await refundPointsAndLog(userId, cost, {
      projectId,
      workflowStepId: stepId,
      billingSource,
      billingGroupId,
      errorMessage: e.message,
    })
  }
}

// 工作指令.txt（2026-05-24）：文本编辑 PATCH，保存用户编辑后的 prompts
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const access = await checkProjectPermission(params.id, undefined, { mode: 'EDIT_STEP', stepType: 'CHARACTER' })
  if (!access.allowed) {
    return access.response
  }

  const body = await req.json().catch(() => ({}))
  const { prompts } = body

  if (!Array.isArray(prompts)) {
    return NextResponse.json({ error: 'VALIDATION_001', message: 'prompts 必须是数组' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CHARACTER' } }
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

  console.log('[TEXT-EDIT-CHARACTER] 保存 prompts 成功, 数量:', prompts.length)
  return NextResponse.json({ success: true })
}
