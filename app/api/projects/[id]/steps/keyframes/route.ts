export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { claimStepForGeneration, completeStep, failStep, canExecuteStep, mergeStepOutputData } from '@/lib/workflow-executor'
import { getProjectDefaultAspectRatio } from '@/lib/server/workflow-state'
import { getStyleRefUrl, getProjectReferences } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'
import { checkPoints, deductPointsAndLog, refundPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS, calculateBatchCost } from '@/lib/points-config'
import { refreshShotsUrls } from '@/lib/resolve-media-url'

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
  const permission = await checkProjectPermission(project.id)
  if (!permission.allowed) {
    return permission.response
  }

  if (!(await canExecuteStep(params.id, 'KEYFRAMES'))) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  // 不再要求 STORYBOARD 步骤 status === 'COMPLETED'：
  // xlsx 导入分镜时步骤可能是 PENDING（历史数据），但 shots 里已经有首帧，
  // 用户完全应该能直接生成尾帧。判据统一成「有没有可用首帧」。
  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  const rawShots = (storyboardStep?.outputData as any)?.shots || []
  if (!storyboardStep || rawShots.length === 0) {
    return NextResponse.json({ error: 'WORKFLOW_003', message: '请先完成分镜设计或导入分镜表' }, { status: 400 })
  }
  if (!rawShots.some((s: any) => Boolean(s?.firstFrameUrl || s?.referenceImageUrl))) {
    return NextResponse.json(
      { error: 'WORKFLOW_003', message: '分镜表里还没有可用首帧，请先生成或导入分镜图' },
      { status: 400 }
    )
  }

  // Phase 4: 从分镜设计读取起始帧
  // 导入的 firstFrameUrl 是 7 天期预签名 URL，过期后直接传给供应商会 403。
  // 有 firstFrameStorageKey 时按 key 重签。
  const storyboardShots = await refreshShotsUrls(rawShots)
  const shotsWithFirstFrame = storyboardShots.shots.filter((s: any) => s.firstFrameUrl)
  if (shotsWithFirstFrame.length === 0) {
    return NextResponse.json(
      { error: 'WORKFLOW_005', message: '请先完成分镜设计的视频生成模式，生成起始帧' },
      { status: 400 }
    )
  }

  const step = await prisma.workflowStep.findUnique({
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
    const promptPointsCheck = await checkPoints(GENERATION_COSTS.DEFAULT, params.id, 'generation.keyframe_prompts', 'TEXT')
    if (!promptPointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

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
          firstFrameStorageKey: shot.firstFrameStorageKey || null,
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
              firstFrameStorageKey: s.firstFrameStorageKey || null,
              description: s.description,
            })),
          },
        },
      })

      await deductPointsAndLog(userId, promptPointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[KEYFRAMES-PROMPT] 生成 ${prompts.length} 条提示词，等待用户确认`)
      return NextResponse.json({ success: true, status: 'PROMPT_READY', prompts })
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || /aborted|timeout|timed out/i.test(e?.message || '')
      const errorMessage = isAbort
        ? '提示词生成超时（模型响应较慢），请稍后重试'
        : e.message
      console.error(`[KEYFRAMES-PROMPT] 失败: ${errorMessage}`, e?.stack?.slice(0, 300))
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

    const imageCost = calculateBatchCost(GENERATION_COSTS.KEYFRAME, prompts.length)
    const pointsCheck = await checkPoints(imageCost, params.id, 'generation.keyframe', 'IMAGE')
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
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

    if (!(await claimStepForGeneration(step.id))) {
      return NextResponse.json(
        { success: true, status: 'PROCESSING', alreadyRunning: true, message: '该步骤的生成任务已在进行中，请等待当前任务完成' },
      )
    }

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
        .map((a: any) => a.url)
        .filter((u: any): u is string => typeof u === 'string' && u.length > 0)
      const refs = await getProjectReferences(params.id).catch(() => [])
      const userRefUrls = refs.filter(r => r.url).map(r => r.url)
      const results = []
      const mockShots: string[] = []

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
        await prisma.asset.create({
          data: {
            projectId: params.id,
            createdById: userId,
            stepId: step.id,
            type: 'IMAGE',
            mimeType: 'image/png',
            storageKey: lastResult.storageKey,
            url: lastResult.url,
            metadata: {
              pairId: promptItem.shotId,
              frameType: 'last',
              quality: 'medium',
              sceneDesc: promptItem.chineseDesc,
              llmPrompt: promptItem.englishPrompt,
              aspectRatio,
              isMock: !!lastResult.isMock,
              ...(lastResult.lastError ? { mockReason: lastResult.lastError } : {}),
            },
          }
        })

        if (lastResult.isMock) {
          mockShots.push(promptItem.shotId)
          console.warn(`[KEYFRAMES-IMAGE] ${promptItem.shotId} 尾帧返回 Mock 占位图: ${lastResult.lastError || '未知原因'}`)
        }

        results.push({
          shotId: promptItem.shotId,
          firstFrameUrl: promptItem.firstFrameUrl || '',
          firstFrameStorageKey: promptItem.firstFrameStorageKey || null,
          lastFrameUrl: lastResult.url,
          lastFrameStorageKey: lastResult.storageKey,
          description: promptItem.chineseDesc,
          actionChange: '',
          isMock: !!lastResult.isMock,
        })
      }

      await completeStep(step.id, { results, keyframes: results, count: results.length, aspectRatio, imageModel: imageModel || 'gpt-image-1' })
      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', {
        projectId: params.id,
        workflowStepId: step.id,
        success: true,
        errorMessage: mockShots.length
          ? `${mockShots.length}/${results.length} 张尾帧回退为占位图（${mockShots.join(', ')}）`
          : undefined,
      })
      // 真实模型全失败时供应商回退到占位图，产出不可用，按条退款
      if (mockShots.length > 0) {
        await refundPointsAndLog(userId, calculateBatchCost(GENERATION_COSTS.KEYFRAME, mockShots.length), {
          projectId: params.id,
          workflowStepId: step.id,
          billingSource: pointsCheck.billingSource,
          billingGroupId: pointsCheck.billingGroupId,
          finalStatus: 'PARTIAL',
          errorMessage: `${mockShots.length}/${results.length} 张尾帧未使用 AI 模型生成（回退为占位图），对应点数已退回`,
        })
      }
      console.log(`[KEYFRAMES-IMAGE] 用户确认，开始生图，共 ${prompts.length} 条，比例 ${aspectRatio}，模型 ${imageModel || '默认'}`)
      return NextResponse.json({ success: true, data: { results, count: results.length } })
    } catch (e: any) {
      await failStep(step.id, e.message)
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === 默认兼容：无 action 时走原有完整流程 ===
  const totalCost = GENERATION_COSTS.DEFAULT + calculateBatchCost(GENERATION_COSTS.KEYFRAME, shotsWithFirstFrame.length)
  const pointsCheck = await checkPoints(totalCost, params.id, 'generation.keyframe', 'IMAGE')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

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

    const results: any[] = []
    const mockShots: string[] = []
    const failedShots: string[] = []

    // 收集角色参考图（用于多图参考：风格图 + 角色图）
    const characterAssets = await prisma.asset.findMany({
      where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
    })
    const characterImageUrls = characterAssets
      .map((a: any) => a.url)
      .filter((u: any): u is string => typeof u === 'string' && u.length > 0)
    const refs = await getProjectReferences(params.id).catch(() => [])
    const userRefUrls = refs.filter((r: any) => r.url).map((r: any) => r.url)
    const defaultRefLabels = refs.filter((r: any) => r.labels?.length).flatMap((r: any) => r.labels)
    const defaultRefHint = refs.length > 0
      ? `\n【参考图】${refs.length} 张用户参考图${defaultRefLabels.length > 0 ? `（标签：${defaultRefLabels.join('、')}）` : ''}。生成 imagePrompt 时可以直接引用参考图中的人物。`
      : ''

    // 逐张增量写回：原来把全部尾帧攒在 results 里、循环结束后才 completeStep。
    // 一旦请求在第 N 张被 Vercel 杀掉，前 N-1 张的 Asset 已建、R2 里已有图，
    // 但 outputData.keyframes 一次都没写 → 前端一张都看不到，步骤还卡在 PROCESSING。
    // 现在每张成功后立刻合并进 outputData，被杀也不会丢已完成的部分。
    const persistProgress = async () => {
      const current = [...results]
      await mergeStepOutputData(step.id, (fresh) => {
        const existing: any[] = Array.isArray(fresh.results) ? fresh.results : []
        const existingByKey = new Map(
          existing.map((r: any) => [`${r.actNumber ?? 0}_${r.shotId}`, r])
        )
        // 用本次结果覆盖同键旧值，其余保留（并发单张生成不会被批量抹掉）
        const merged = new Map<string, any>()
        for (const r of existing) merged.set(`${r.actNumber ?? 0}_${r.shotId}`, r)
        for (const r of current) merged.set(`${r.actNumber ?? 0}_${r.shotId}`, r)
        return {
          ...fresh,
          results: [...merged.values()],
          keyframes: [...merged.values()],
          count: merged.size,
        }
      })
    }

    for (const shot of shotsWithFirstFrame) {
      const shotKey = `${shot.actNumber ?? 0}_${shot.shotId}`
      try {
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

        if (lastResult.isMock) {
          // Mock 占位图不是有效产出：既不建 Asset（会污染资产表和贡献度统计），
          // 也不写 outputData，只记进 mockShots 用于退款
          mockShots.push(shot.shotId)
          console.warn(`[KEYFRAMES] ${shot.shotId} 尾帧返回 Mock 占位图: ${lastResult.lastError || '未知原因'}`)
          continue
        }

        const lastAsset = await prisma.asset.create({
          data: {
            projectId: params.id,
            createdById: userId,
            stepId: step.id,
            type: 'IMAGE',
            mimeType: 'image/png',
            storageKey: lastResult.storageKey,
            url: lastResult.url,
            metadata: {
              pairId: shot.shotId,
              frameType: 'last',
              quality: 'medium',
              sceneDesc: shot.description,
              llmPrompt: lastPromptText,
              isMock: false,
            },
          },
        })
        void lastAsset

        results.push({
          shotId: shot.shotId,
          actNumber: shot.actNumber,
          firstFrameUrl: shot.firstFrameUrl,  // Phase 4: 只读引用，来自分镜设计
          firstFrameStorageKey: shot.firstFrameStorageKey || null,
          lastFrameUrl: lastResult.url,
          lastFrameStorageKey: lastResult.storageKey,
          description: shot.description,
          actionChange: '',
          isMock: false,
        })
        // 每张成功后立刻落库，被杀也不丢
        await persistProgress()
      } catch (shotErr: any) {
        console.error(`[KEYFRAMES] ${shotKey} 尾帧生成失败:`, shotErr?.message)
        failedShots.push(shot.shotId)
        // 继续下一张，不中断整批
      }
    }

    console.log(
      `[KEYFRAMES-xxx] 尾帧生成完成: 成功 ${results.length}, Mock ${mockShots.length}, 失败 ${failedShots.length}`
    )
    await completeStep(step.id, { count: results.length })
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', {
      projectId: params.id,
      workflowStepId: step.id,
      success: true,
      errorMessage:
        mockShots.length || failedShots.length
          ? `${mockShots.length + failedShots.length}/${shotsWithFirstFrame.length} 张尾帧未产出（Mock ${mockShots.length}、失败 ${failedShots.length}）`
          : undefined,
    })
    // Mock 占位与真实失败都不算有效产出，按条退款
    const unbilled = mockShots.length + failedShots.length
    if (unbilled > 0) {
      await refundPointsAndLog(userId, calculateBatchCost(GENERATION_COSTS.KEYFRAME, unbilled), {
        projectId: params.id,
        workflowStepId: step.id,
        billingSource: pointsCheck.billingSource,
        billingGroupId: pointsCheck.billingGroupId,
        finalStatus: 'PARTIAL',
        errorMessage: `${unbilled}/${shotsWithFirstFrame.length} 张尾帧未使用 AI 模型生成（Mock ${mockShots.length}、失败 ${failedShots.length}），对应点数已退回`,
      })
    }
    return NextResponse.json({ success: true, data: { results, count: results.length } })
  } catch (e: any) {
    await failStep(step.id, e.message)
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

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
  const permission = await checkProjectPermission(project.id)
  if (!permission.allowed) {
    return permission.response
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

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await checkProjectPermission(params.id)
  if (!access.allowed) return access.response

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'KEYFRAMES' } },
    include: { resultAssets: true }
  })
  if (!step) return NextResponse.json({ status: 'not_found' })

  // Phase 4: 合并分镜设计的起始帧到输出数据
  // 预签名 URL 过期后前端 <img> 会 403，这里按 storageKey 重签后再返回
  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  const rawShots = (storyboardStep?.outputData as any)?.shots || []
  const storyboardShots = await refreshShotsUrls(rawShots)
  const shotFirstFrames: Record<string, string> = {}
  for (const s of storyboardShots.shots) {
    if (s.firstFrameUrl) shotFirstFrames[s.shotId] = s.firstFrameUrl
  }

  const outputData = step.outputData as any || {}
  const rawKeyframes = outputData.keyframes || outputData.results || []
  const refreshedKeyframes = await refreshShotsUrls(rawKeyframes)
  const keyframes = refreshedKeyframes.shots
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
