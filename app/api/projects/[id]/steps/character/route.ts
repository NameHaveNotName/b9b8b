export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { IMAGE_MODELS } from '@/lib/models-config'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { getStyleRefUrl } from '@/lib/style-ref'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'
import { logOperation } from '@/lib/operations'
import { STEP_COSTS } from '@/lib/points-config'

/**
 * 生成角色提示词（供 generate-prompts 和 generate-images 共用）
 * 成功返回 { prompts, characterCount }，失败抛出异常（调用方需 catch 并 failStep）
 */
async function generateCharacterPrompts(
  project: any,
  frameworkStep: any,
  stepId: string
): Promise<{ prompts: any[]; characterCount: number }> {
  const framework = (project.framework || frameworkStep.outputData) as any
  const allCharacters: Array<{ id: string; name: string; role: string; description: string }> =
    framework?.characters || []
  const characters = allCharacters.slice(0, 5)

  const prompt = loadPromptTemplate('character', {
    USER_INPUT: JSON.stringify(framework)
  })
  const textClient = await getTextClient()
  const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
  const parsed = extractJsonFromMarkdown(resultText)
  const parsedChars = parsed.characters || []

  const prompts = characters.map((character, i) => {
    const charData = parsedChars.find((c: any) => c.characterId === character.id || c.name === character.name)
    const charDesc = charData?.description || character.description || `${character.name}（${character.role}）`
    // 过滤空白，确保 englishPrompt 是有效的英文内容
    const rawPrompt = charData?.imagePrompt || ''
    const isValidEnglishPrompt = rawPrompt.trim().length > 10 && /[a-zA-Z]{3,}/.test(rawPrompt)
    // 如果 LLM 返回了有效的英文提示词则使用；否则用 charDesc 构建完整英文描述
    const englishPrompt = isValidEnglishPrompt
      ? rawPrompt.trim()
      : `Cinematic character portrait of ${character.name}, ${charDesc}. Solo portrait, front-facing, complete full face clearly visible. Cinematic film still, 35mm Kodak Portra 400, atmospheric depth, 8k, poetic realism.`
    return {
      id: `prompt_${i + 1}`,
      chineseDesc: charDesc,
      englishPrompt,
      target: `character_${character.id}`,
      characterName: character.name,
      characterId: character.id,
      role: character.role,
    }
  })

  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
  await prisma.workflowStep.update({
    where: { id: stepId },
    data: {
      status: 'PENDING' as any,
      outputData: {
        ...(step?.outputData as any || {}),
        prompts,
        characterCount: characters.length,
      },
    },
  })

  console.log(`[CHARACTER-PROMPT] 生成 ${prompts.length} 条提示词`)
  return { prompts, characterCount: characters.length }
}

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

  if (!await canExecuteStep(params.id, 'CHARACTER')) {
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
    try {
      console.log('[CHARACTER-PROMPT] 收到 generate-prompts 请求')
      const { prompts } = await generateCharacterPrompts(project, frameworkStep, step.id)
      return NextResponse.json({ success: true, status: 'PROMPT_READY', prompts })
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || /aborted|timeout|timed out/i.test(e?.message || '')
      const errorMessage = isAbort
        ? '提示词生成超时（模型响应较慢），请稍后重试'
        : e.message
      console.error(`[CHARACTER-PROMPT] 失败: ${errorMessage}`, e?.stack?.slice(0, 300))
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
    console.log(`[ASPECT-RATIO] [CHARACTER-IMAGE] 用户选择比例: ${aspectRatio}`)
    console.log(`[MODEL-SELECT] [CHARACTER-IMAGE] 用户选择模型: ${imageModel || '默认'}`)

    const existingOutput = (step.outputData as any) || {}
    const prompts = existingOutput.prompts || []
    console.log('[CHARACTER-IMAGE] existingOutput keys:', Object.keys(existingOutput))
    console.log('[CHARACTER-IMAGE] prompts count:', prompts.length)

    // 工作指令.txt（2026-06-07）：prompts 为空时自动触发提示词生成，不返回 400
    let resolvedPrompts = prompts
    if (resolvedPrompts.length === 0) {
      console.warn('[CHARACTER-IMAGE] No prompts found, auto-triggering prompt generation')
      try {
        const generated = await generateCharacterPrompts(project, frameworkStep, step.id)
        resolvedPrompts = generated.prompts
        console.log(`[CHARACTER-IMAGE] Auto-generated ${resolvedPrompts.length} prompts, continuing to image generation`)
      } catch (promptErr: any) {
        const isAbort = promptErr?.name === 'AbortError' || /aborted|timeout|timed out/i.test(promptErr?.message || '')
        const errorMessage = isAbort
          ? '提示词生成超时（模型响应较慢），请稍后重试'
          : promptErr.message
        console.error(`[CHARACTER-IMAGE] Auto-prompt generation failed: ${errorMessage}`, promptErr?.stack?.slice(0, 300))
        await failStep(step.id, errorMessage)
        return NextResponse.json({ error: 'API_001', message: errorMessage }, { status: 500 })
      }
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

    await startStep(step.id)

    try {
      const framework = (project.framework || frameworkStep.outputData) as any

      const styleStep = await prisma.workflowStep.findFirst({
        where: { projectId: params.id, stepType: 'STYLE', status: 'COMPLETED' }
      })

      let styleRefUrl: string | undefined
      let stylePrompt: string | undefined
      if (styleStep) {
        try {
          const ref = await getStyleRefUrl(params.id)
          styleRefUrl = ref.styleRefUrl
          stylePrompt = ref.stylePrompt
          console.log(`[CHARACTER-IMAGE] 注入风格图: ${styleRefUrl}`)
        } catch (refErr: any) {
          console.log(`[CHARACTER-IMAGE] 风格图提取失败，回退到无风格模式`)
        }
      }

      const imageClient = await getImageClient()
      const portraits = []
      const failedCharacters: string[] = []

      for (const promptItem of resolvedPrompts) {
        try {
          const enrichedCharacter = {
            id: promptItem.characterId,
            name: promptItem.characterName,
            role: promptItem.role || '',
            description: promptItem.englishPrompt || promptItem.chineseDesc,
          }

          const result = await imageClient.generateCharacterPortrait(
            params.id,
            enrichedCharacter,
            styleRefUrl,
            stylePrompt,
            aspectRatio,
            imageModel
          )
          // 防御：确保 result 包含必需的 url 和 storageKey
          if (!result?.url || !result?.storageKey) {
            console.error(`[CHARACTER-IMAGE] 角色 ${promptItem.characterName} 返回结果缺少 url/storageKey:`, JSON.stringify(result))
            failedCharacters.push(promptItem.characterName)
            continue
          }
          const asset = await prisma.asset.create({
            data: {
              projectId: params.id,
              stepId: step.id,
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
                isMock: !!result.isMock,
                ...(result.lastError ? { mockReason: result.lastError } : {}),
              },
            },
          })
          console.log(`[CHARACTER-IMAGE] Asset 创建成功: assetId=${asset.id}, stepId=${step.id}, char=${promptItem.characterName}, url=${result.url.slice(0, 60)}`)
          portraits.push({ character: enrichedCharacter, assetId: asset.id, url: result.url, llmPrompt: promptItem.englishPrompt })
        } catch (imgErr: any) {
          console.error(`[CHARACTER-IMAGE] 角色 ${promptItem.characterName} 生图失败:`, imgErr?.message)
          failedCharacters.push(promptItem.characterName)
        }
      }

      if (portraits.length === 0) {
        const errMsg = `所有角色生图均失败${failedCharacters.length > 0 ? '（' + failedCharacters.join(', ') + '）' : ''}`
        await failStep(step.id, errMsg)
        await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: errMsg })
        return NextResponse.json({ error: 'API_001', message: errMsg }, { status: 500 })
      }

      await completeStep(step.id, { portraits, characterCount: portraits.length, imageModel: imageModel || IMAGE_MODELS.primary, aspectRatio })
      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      // 验证数据库中 Asset 是否真实存在
      const dbAssetCount = await prisma.asset.count({ where: { stepId: step.id } })
      console.log(`[CHARACTER-IMAGE] 完成: 成功 ${portraits.length}/${resolvedPrompts.length} 条，失败: ${failedCharacters.join(', ') || '无'}，数据库 Asset 数: ${dbAssetCount}`)
      return NextResponse.json({ success: true, data: { portraits, characterCount: portraits.length } })
    } catch (e: any) {
      await failStep(step.id, e.message)
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
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

  await startStep(step.id)

  try {
    const framework = (project.framework || frameworkStep.outputData) as any
    const allCharacters: Array<{ id: string; name: string; role: string; description: string }> =
      framework?.characters || []

    // 数量控制：最多 5 个角色
    const characters = allCharacters.slice(0, 5)

    // Phase 6: 前置步骤检测 — 风格统一步骤状态
    const styleStep = await prisma.workflowStep.findFirst({
      where: { projectId: params.id, stepType: 'STYLE', status: 'COMPLETED' }
    })
    console.log(`[CHARACTER] 风格统一步骤状态: ${styleStep ? '已完成' : '未执行/跳过'}`)

    // Phase 6: 风格图提取
    let styleRefUrl: string | undefined
    let stylePrompt: string | undefined
    if (styleStep) {
      try {
        const ref = await getStyleRefUrl(params.id)
        styleRefUrl = ref.styleRefUrl
        stylePrompt = ref.stylePrompt
        console.log(`[CHARACTER] 注入风格图: ${styleRefUrl}`)
      } catch (refErr: any) {
        // Phase 6: 风格图注入失败不阻断流程
        console.log(`[CHARACTER] 风格图提取失败: ${refErr?.message}，回退到无风格模式`)
      }
    }

    if (!styleRefUrl) {
      console.log('[CHARACTER] 无风格图，直接文生图')
    }

    // 1. 用文本模板生成角色提示词
    const prompt = loadPromptTemplate('character', {
      USER_INPUT: JSON.stringify(framework)
    })
    const textClient = await getTextClient()
    const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
    const parsed = extractJsonFromMarkdown(resultText)
    const parsedChars = parsed.characters || []

    // 2. 用图像 API 生成角色概念图
    const imageClient = await getImageClient()
    const portraits = []
    const failedCharacters: string[] = []

    for (const character of characters) {
      try {
        // 优先使用 LLM 生成的 imagePrompt，否则 fallback 到基础描述
        const charData = parsedChars.find((c: any) => c.characterId === character.id || c.name === character.name)
        const charPrompt = charData?.imagePrompt || ''
        const enrichedCharacter = charPrompt
          ? { ...character, description: `${character.description} ${charPrompt}` }
          : character

        // Phase 6: 有风格图时注入，无风格图时直接文生图
        const result = await imageClient.generateCharacterPortrait(
          params.id,
          enrichedCharacter,
          styleRefUrl,
          stylePrompt
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
              characterId: character.id,
              characterName: character.name,
              chineseDesc: character.description || `${character.name}（${character.role}）`,
              styleRefUrl: styleRefUrl || null,
              llmPrompt: charPrompt,
              aspectRatio: '16:9',
              imageModel: IMAGE_MODELS.primary,
              isMock: !!result.isMock,
              ...(result.lastError ? { mockReason: result.lastError } : {}),
            },
          },
        })
        portraits.push({ character, assetId: asset.id, url: result.url, llmPrompt: charPrompt })
      } catch (imgErr: any) {
        console.error(`[CHARACTER] 角色 ${character.name} 生图失败:`, imgErr?.message)
        failedCharacters.push(character.name)
      }
    }

    if (portraits.length === 0) {
      const errMsg = `所有角色生图均失败${failedCharacters.length > 0 ? '（' + failedCharacters.join(', ') + '）' : ''}`
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

    await completeStep(step.id, { portraits, characterCount: portraits.length })
    await logOperation({
      userId,
      projectId: params.id,
      workflowStepId: step.id,
      actionType: 'generate',
      cost: STEP_COSTS.character,
      status: 'success',
    })
    return NextResponse.json({ success: true, data: { portraits, characterCount: portraits.length } })
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
