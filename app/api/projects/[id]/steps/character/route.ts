import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { IMAGE_MODELS } from '@/lib/models-config'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { getStyleRefUrl } from '@/lib/style-ref'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
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
        const charPrompt = charData?.imagePrompt || ''
        return {
          id: `prompt_${i + 1}`,
          chineseDesc: character.description || '',
          englishPrompt: charPrompt || `Character portrait: ${character.name}, ${character.role}`,
          target: `character_${character.id}`,
          characterName: character.name,
          characterId: character.id,
          role: character.role,
        }
      })

      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: 'PENDING' as any,
          outputData: {
            ...(step.outputData as any || {}),
            prompts,
            characterCount: characters.length,
          },
        },
      })

      console.log(`[CHARACTER-PROMPT] 生成 ${prompts.length} 条提示词，等待用户确认`)
      return NextResponse.json({ success: true, status: 'PROMPT_READY', prompts })
    } catch (e: any) {
      await failStep(step.id, e.message)
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === generate-images: 读取已保存提示词，执行生图 ===
  if (action === 'generate-images') {
    const aspectRatio = body?.aspectRatio || '16:9'
    const imageModel = body?.imageModel
    console.log(`[ASPECT-RATIO] [CHARACTER-IMAGE] 用户选择比例: ${aspectRatio}`)
    console.log(`[MODEL-SELECT] [CHARACTER-IMAGE] 用户选择模型: ${imageModel || '默认'}`)

    const existingOutput = (step.outputData as any) || {}
    const prompts = existingOutput.prompts || []
    if (prompts.length === 0) {
      return NextResponse.json({ error: 'No prompts found. Please call generate-prompts first.' }, { status: 400 })
    }

    if (force) {
      console.log('[CHARACTER-IMAGE] force=true, clearing old assets')
      await prisma.asset.deleteMany({
        where: { projectId: params.id, step: { stepType: 'CHARACTER' } }
      })
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: 'PENDING' as any, outputData: existingOutput, errorMessage: null },
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

      for (const promptItem of prompts) {
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
              styleRefUrl: styleRefUrl || null,
              llmPrompt: promptItem.englishPrompt,
              aspectRatio,
              imageModel: imageModel || IMAGE_MODELS.primary,
              isMock: !!result.isMock,
              ...(result.lastError ? { mockReason: result.lastError } : {}),
            },
          },
        })
        portraits.push({ character: enrichedCharacter, assetId: asset.id, url: result.url, llmPrompt: promptItem.englishPrompt })
      }

      await completeStep(step.id, { portraits, characterCount: prompts.length, imageModel: imageModel || IMAGE_MODELS.primary, aspectRatio })
      console.log(`[CHARACTER-IMAGE] 用户确认，开始生图，共 ${prompts.length} 条，比例 ${aspectRatio}，模型 ${imageModel || '默认'}`)
      return NextResponse.json({ success: true, data: { portraits, characterCount: prompts.length } })
    } catch (e: any) {
      await failStep(step.id, e.message)
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === 默认兼容：无 action 时走原有完整流程 ===
  if (!force && step.status === 'COMPLETED' && step.outputData) {
    console.log('[CHARACTER] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  if (force) {
    console.log('[CHARACTER] force=true, resetting step and clearing old assets')
    await prisma.asset.deleteMany({
      where: { projectId: params.id, step: { stepType: 'CHARACTER' } }
    })
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PENDING' as any, outputData: {}, errorMessage: null },
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

    for (const character of characters) {
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
    }

    await completeStep(step.id, { portraits, characterCount: characters.length })
    return NextResponse.json({ success: true, data: { portraits, characterCount: characters.length } })
  } catch (e: any) {
    await failStep(step.id, e.message)
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

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
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
