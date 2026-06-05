export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown, assignModelNoFallback } from '@/lib/prompts'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { createQueue } from '@/lib/queue'
import { processStyleGeneration } from '@/lib/style-processor'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'
import { logOperation } from '@/lib/operations'
import { STEP_COSTS } from '@/lib/points-config'

const styleQueue = createQueue('style-generation')

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  if (!await canExecuteStep(params.id, 'STYLE')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  const frameworkStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
  })
  if (!frameworkStep || frameworkStep.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'WORKFLOW_003' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STYLE' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const force = body?.force === true
  const action: 'generate-prompts' | 'generate-images' = body?.action || 'generate-images'

  // === generate-prompts: 只生成提示词，不生图 ===
  if (action === 'generate-prompts') {
    try {
      console.log('[STYLE-PROMPT] 收到 generate-prompts 请求')

      const framework = project.framework || (frameworkStep.outputData as any)
      const storyBrief = framework?.synopsis || framework?.storyBrief || ''
      const visualKeywords = framework?.visualStyle || framework?.styleGuide || framework?.visualKeywords || ''
      const mood = framework?.mood || framework?.atmosphere || ''

      const prompt = loadPromptTemplate('style-generation', {
        STORY_BRIEF: storyBrief,
        VISUAL_KEYWORDS: visualKeywords,
        MOOD: mood,
      })
      const textClient = await getTextClient()
      const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
      const parsed = extractJsonFromMarkdown(resultText)

      let styleOptions: any[] = []
      if (Array.isArray(parsed)) {
        styleOptions = parsed
      } else if (Array.isArray(parsed.styles)) {
        styleOptions = parsed.styles.map((s: any, i: number) => ({
          id: s.id || String(i + 1),
          styleName: s.styleName || s.label || `风格 ${i + 1}`,
          styleDescription: s.styleDescription || s.description || '',
          prompt: s.prompt || s.stylePrompt || '',
          modelNo: s.modelNo,
        }))
      } else if (Array.isArray(parsed.styleOptions)) {
        styleOptions = parsed.styleOptions
      }

      // 工作指令.txt（2026-05-24）：modelNo 校验与兜底分配
      styleOptions = assignModelNoFallback(styleOptions)
      console.log('[STYLE-MODEL-ASSIGN] LLM 分配结果:', styleOptions.map((s: any) =>
        ({ name: s.styleName, modelNo: s.modelNo })
      ))

      // 生成中英文提示词（保留 modelNo）
      const prompts = styleOptions.map((s, i) => ({
        id: `prompt_${i + 1}`,
        chineseDesc: s.styleDescription || s.description || '',
        englishPrompt: s.prompt || s.stylePrompt || '',
        target: `style_sample_${i + 1}`,
        styleName: s.styleName || `风格 ${i + 1}`,
        styleId: s.id || String(i + 1),
        modelNo: s.modelNo,
      }))

      // 暂存到 outputData.prompts
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: 'PENDING' as any,
          outputData: {
            ...(step.outputData as any || {}),
            prompts,
            styleOptions: styleOptions.map((s, i) => ({
              ...s,
              id: s.id || String(i + 1),
              imageUrl: null,
            })),
            selectedStyleId: null,
            styleRefUrl: null,
            generatedCount: 0,
          },
        },
      })

      console.log(`[STYLE-PROMPT] 生成 ${prompts.length} 条提示词，等待用户确认`)
      return NextResponse.json({
        success: true,
        status: 'PROMPT_READY',
        prompts,
      })
    } catch (e: any) {
      // 工作指令.txt（2026-06-04）：区分 AbortError（超时）与其他错误，给用户更友好的提示
      const isAbort = e?.name === 'AbortError' || /aborted|timeout|timed out/i.test(e?.message || '')
      const errorMessage = isAbort
        ? '提示词生成超时（模型响应较慢），请稍后重试'
        : e.message
      console.error(`[STYLE-PROMPT] 失败: ${errorMessage}`, e?.stack?.slice(0, 300))
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
    console.log(`[ASPECT-RATIO] [STYLE-IMAGE] 用户选择比例: ${aspectRatio}`)
    console.log(`[MODEL-SELECT] [STYLE-IMAGE] 用户选择模型: ${imageModel || '默认'}`)

    const existingOutput = (step.outputData as any) || {}
    const prompts = existingOutput.prompts || []
    // 工作指令.txt（2026-06-04）：增加详细日志，帮助排查 prompts 数据流断裂
    console.log('[STYLE-IMAGE] existingOutput keys:', Object.keys(existingOutput))
    console.log('[STYLE-IMAGE] prompts count:', prompts.length)
    console.log('[STYLE-IMAGE] step.status:', step.status, 'step.id:', step.id)
    if (prompts.length === 0) {
      console.error('[STYLE-IMAGE] No prompts found. existingOutput:', JSON.stringify(existingOutput).slice(0, 500))
      return NextResponse.json({ error: 'No prompts found. Please call generate-prompts first.' }, { status: 400 })
    }

    // force=true 时清空旧资产
    if (force) {
      console.log('[STYLE-IMAGE] force=true, clearing old assets')
      await prisma.asset.deleteMany({
        where: { projectId: params.id, step: { stepType: 'STYLE' } }
      })
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: 'PENDING' as any, outputData: existingOutput, errorMessage: null },
      })
    }

    await startStep(step.id)

    // 构建 styleOptions 用于生图（携带 modelNo）
    const styleOptions = prompts.map((p: any) => ({
      id: p.styleId || p.id,
      styleName: p.styleName,
      styleDescription: p.chineseDesc,
      prompt: p.englishPrompt,
      imageUrl: null,
      modelNo: p.modelNo,
    }))

    try {
      const useQueue = process.env.STYLE_USE_QUEUE === '1'
      let queued = false

      if (useQueue) {
        try {
          await styleQueue.add(
            'generate-style-images',
            { stepId: step.id, projectId: params.id, styleOptions, aspectRatio, imageModel },
            {
              attempts: 2,
              backoff: { type: 'exponential', delay: 3000 },
              removeOnComplete: 50,
              removeOnFail: 50,
            }
          )
          queued = true
          console.log('[STYLE-IMAGE] Job queued via BullMQ')
        } catch (queueErr: any) {
          console.warn('[STYLE-IMAGE] BullMQ queue failed, fallback to setImmediate:', queueErr.message)
        }
      }

      if (!queued) {
        setImmediate(async () => {
          try {
            await processStyleGeneration(step.id, params.id, styleOptions, aspectRatio, imageModel)
          } catch (e: any) {
            // 工作指令.txt（2026-06-02 卡死修复）：后台处理失败必须标记状态为 FAILED
            const errMessage = e?.message || 'background style generation failed'
            const errDetail = (e?.stack || '').toString().slice(0, 500)
            console.error('[STYLE-IMAGE] Background processing failed:', errMessage, errDetail)
            try {
              await failStep(step.id, `${errMessage} | detail: ${errDetail}`)
            } catch (failErr: any) {
              console.error('[STYLE-IMAGE] failStep also failed:', failErr?.message)
              // 兜底：直接更新数据库
              try {
                await prisma.workflowStep.update({
                  where: { id: step.id },
                  data: { status: 'FAILED' as any, errorMessage: errMessage.slice(0, 200) },
                })
              } catch {}
            }
            // 记录失败日志
            try {
              await logOperation({
                userId,
                projectId: params.id,
                workflowStepId: step.id,
                actionType: 'error',
                cost: 0,
                status: 'failed',
                metadata: { error: errMessage, detail: errDetail, phase: 'background-generation' },
              })
            } catch {}
          }
        })
      }

      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[STYLE-IMAGE] 用户确认，开始生图，共 ${prompts.length} 条，比例 ${aspectRatio}，模型 ${imageModel || '默认'}`)
      return NextResponse.json({
        success: true,
        message: queued ? '风格生成任务已入队' : '风格生成任务已在后台启动',
        status: 'PROCESSING',
      })
    } catch (e: any) {
      await failStep(step.id, e.message)
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === 默认兼容：无 action 时走原有完整流程（向后兼容） ===
  if (!force && step.status === 'COMPLETED' && step.outputData) {
    console.log('[STYLE] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  if (!force && step.status === 'PROCESSING') {
    return NextResponse.json({ success: true, message: '生成任务已在进行中', status: 'PROCESSING' })
  }

  if (force) {
    console.log('[STYLE] force=true, clearing old assets')
    await prisma.asset.deleteMany({
      where: { projectId: params.id, step: { stepType: 'STYLE' } }
    })
    // 工作指令.txt（2026-06-04）：force=true 时不应清空 prompts，避免用户编辑的提示词丢失。
    // 仅清空图片相关字段，保留 prompts、styleOptions 的文本数据。
    const existingOutput = (step.outputData as any) || {}
    const preservedOutput = {
      prompts: existingOutput.prompts,
      styleOptions: existingOutput.styleOptions?.map((s: any) => ({
        ...s,
        imageUrl: null,
        assetId: undefined,
      })),
      selectedStyleId: null,
      styleRefUrl: null,
      generatedCount: 0,
    }
    console.log('[STYLE] force=true, preserved prompts count:', existingOutput.prompts?.length || 0)
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PENDING' as any, outputData: preservedOutput, errorMessage: null },
    })
  }

  await startStep(step.id)

  try {
    const framework = project.framework || (frameworkStep.outputData as any)
    const storyBrief = framework?.synopsis || framework?.storyBrief || ''
    const visualKeywords = framework?.visualStyle || framework?.styleGuide || framework?.visualKeywords || ''
    const mood = framework?.mood || framework?.atmosphere || ''

    // 1. 用文本模板生成 3 组风格提示词
    const prompt = loadPromptTemplate('style-generation', {
      STORY_BRIEF: storyBrief,
      VISUAL_KEYWORDS: visualKeywords,
      MOOD: mood,
    })
    const textClient = await getTextClient()
    const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
    const parsed = extractJsonFromMarkdown(resultText)

    // 解析风格选项
    let styleOptions: any[] = []
    if (Array.isArray(parsed)) {
      styleOptions = parsed
    } else if (Array.isArray(parsed.styles)) {
      styleOptions = parsed.styles.map((s: any, i: number) => ({
        id: s.id || String(i + 1),
        styleName: s.styleName || s.label || `风格 ${i + 1}`,
        styleDescription: s.styleDescription || s.description || '',
        prompt: s.prompt || s.stylePrompt || '',
      }))
    } else if (Array.isArray(parsed.styleOptions)) {
      styleOptions = parsed.styleOptions
    }

    styleOptions = styleOptions.map((s, i) => ({
      ...s,
      id: s.id || String(i + 1),
      imageUrl: null,
    }))

    if (styleOptions.length < 3) {
      throw new Error(`风格选项不足：期望 3 组，实际得到 ${styleOptions.length} 组`)
    }

    // 2. 将风格选项暂存到步骤输出中
    const outputData = {
      styleOptions,
      selectedStyleId: null,
      styleRefUrl: null,
      generatedCount: 0,
    }
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { outputData },
    })

    // 3. 任务派发：默认走 setImmediate 后台处理（保证无 Redis/无独立 Worker 也能完成）。
    //    仅当显式开启 STYLE_USE_QUEUE=1 时才尝试 BullMQ，避免"入队成功但 Worker 未启动"导致卡 95%。
    const useQueue = process.env.STYLE_USE_QUEUE === '1'
    let queued = false

    if (useQueue) {
      try {
        await styleQueue.add(
          'generate-style-images',
          { stepId: step.id, projectId: params.id, styleOptions },
          {
            attempts: 2,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: 50,
            removeOnFail: 50,
          }
        )
        queued = true
        console.log('[STYLE] Job queued via BullMQ')
      } catch (queueErr: any) {
        console.warn('[STYLE] BullMQ queue failed, fallback to setImmediate:', queueErr.message)
      }
    }

    if (!queued) {
      // 后台直接处理：HTTP 立即返回，生成在后台执行；processStyleGeneration 内部已有
      // try/catch + failStep，绝不会让 step 卡在 PROCESSING。
      setImmediate(async () => {
        try {
          await processStyleGeneration(step.id, params.id, styleOptions)
        } catch (e: any) {
          // 工作指令.txt（2026-06-02 卡死修复）：后台处理失败必须标记状态为 FAILED
          const errMessage = e?.message || 'background style generation failed'
          const errDetail = (e?.stack || '').toString().slice(0, 500)
          console.error('[STYLE] Background processing failed:', errMessage, errDetail)
          try {
            await failStep(step.id, `${errMessage} | detail: ${errDetail}`)
          } catch (failErr: any) {
            console.error('[STYLE] failStep also failed:', failErr?.message)
            try {
              await prisma.workflowStep.update({
                where: { id: step.id },
                data: { status: 'FAILED' as any, errorMessage: errMessage.slice(0, 200) },
              })
            } catch {}
          }
          try {
            await logOperation({
              userId,
              projectId: params.id,
              workflowStepId: step.id,
              actionType: 'error',
              cost: 0,
              status: 'failed',
              metadata: { error: errMessage, detail: errDetail, phase: 'background-generation-compat' },
            })
          } catch {}
        }
      })
    }

    await logOperation({
      userId,
      projectId: params.id,
      workflowStepId: step.id,
      actionType: 'generate',
      cost: STEP_COSTS.style,
      status: 'success',
    })
    return NextResponse.json({
      success: true,
      message: queued ? '风格生成任务已入队' : '风格生成任务已在后台启动',
      status: 'PROCESSING',
      data: outputData,
    })
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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STYLE' } },
    include: { resultAssets: true },
  })
  if (!step) return NextResponse.json({ status: 'not_found' })

  const outputData = step.outputData as any
  let styleOptions = outputData?.styleOptions || []
  const assets = step.resultAssets || []
  if (styleOptions.length > 0 && assets.length > 0) {
    styleOptions = styleOptions.map((opt: any, idx: number) => {
      const asset = assets.find((a: any) => (a.metadata as any)?.styleId === opt.id)
      return {
        ...opt,
        imageUrl: asset?.url || opt.imageUrl,
        assetId: asset?.id,
      }
    })
  }

  return NextResponse.json({
    status: step.status,
    outputData: {
      ...outputData,
      styleOptions,
    },
    assets: step.resultAssets,
    errorMessage: step.errorMessage,
  })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const body = await req.json()
  const { selectedStyleId, styleRefUrl, prompts } = body

  // 工作指令.txt（2026-05-24）：支持 prompts 文本编辑（与风格选择互斥分支）
  if (Array.isArray(prompts)) {
    const existing = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId: params.id, stepType: 'STYLE' } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
    }
    const existingOutput = (existing.outputData || {}) as any
    const newOutput = { ...existingOutput, prompts }
    await prisma.workflowStep.update({
      where: { id: existing.id },
      data: { outputData: newOutput },
    })
    console.log('[TEXT-EDIT-STYLE] 保存 prompts 成功, 数量:', prompts.length)
    return NextResponse.json({ success: true })
  }

  // 【强制日志1】确认收到什么
  console.log('[STYLE-PATCH-REQ] 收到 body:', JSON.stringify(body))
  console.log('[STYLE-PATCH-REQ] selectedStyleId:', selectedStyleId)
  console.log('[STYLE-PATCH-REQ] styleRefUrl:', styleRefUrl)
  console.log('[STYLE-PATCH-REQ] styleRefUrl 类型:', typeof styleRefUrl)
  console.log('[STYLE-PATCH-REQ] styleRefUrl 是否http开头:', styleRefUrl?.startsWith?.('http'))

  // 工作指令.txt（修复一-后端）：放宽校验。
  // R2 上传失败时，前端会拿到 data:image/png;base64,... 的 URL；
  // 浏览器能显示说明 URL 有效，后端不应再强制 http 前缀。
  if (
    !selectedStyleId ||
    !styleRefUrl ||
    typeof styleRefUrl !== 'string' ||
    styleRefUrl.trim() === ''
  ) {
    return NextResponse.json({ error: 'VALIDATION_001', message: '缺少有效参数' }, { status: 400 })
  }

  // 读取现有 output
  const existing = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STYLE' } },
  })
  console.log('[STYLE-PATCH-DB] 更新前 outputData:', JSON.stringify(existing?.outputData).slice(0, 500))

  const existingOutput = (existing?.outputData || {}) as any
  const newOutput = {
    ...existingOutput,
    selectedStyleId,
    styleRefUrl,
  }

  // 更新数据库（事务：workflowStep + project.selectedStyleId 双写，保证前端 isSelected 正确读取）
  const [updated] = await prisma.$transaction([
    prisma.workflowStep.update({
      where: { id: existing!.id },
      data: { outputData: newOutput, status: 'COMPLETED' },
    }),
    prisma.project.update({
      where: { id: params.id },
      data: { selectedStyleId },
    }),
  ])

  // 【强制日志3】确认写入成功
  console.log('[STYLE-PATCH-DB] 更新后 outputData:', JSON.stringify(updated.outputData).slice(0, 500))
  console.log('[STYLE-PATCH-DB] 更新后 styleRefUrl:', (updated.outputData as any)?.styleRefUrl)
  console.log('[STYLE-PATCH-DB] project.selectedStyleId 已同步:', selectedStyleId)

  return NextResponse.json({ success: true, data: updated.outputData })
}
