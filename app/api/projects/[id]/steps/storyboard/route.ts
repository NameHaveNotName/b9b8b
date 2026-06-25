export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { generateImage } from '@/lib/api-clients/xiaomi'
import { getStyleRefUrl } from '@/lib/style-ref'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import sharp from 'sharp'
import { IMAGE_MODELS } from '@/lib/models-config'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'
import { logOperation } from '@/lib/operations'
import { STEP_COSTS } from '@/lib/points-config'

async function generateStoryboardByAct(textClient: any, framework: any, act: any) {
  const prompt = loadPromptTemplate('storyboard-act-dynamic', {
    USER_INPUT: JSON.stringify(framework),
    ACT_NUMBER: String(act.actNo || act.actNumber || 1),
    ACT_TITLE: act.title || `第${act.actNo || act.actNumber || 1}幕`,
    ACT_CONTENT: act.content || '',
    ESTIMATED_SHOTS: String(typeof act.estimatedShots === 'number' ? act.estimatedShots : 10),
    ACT_PACING: act.pacing || '张弛有度',
    KEY_SCENES: Array.isArray(act.keyScenes) ? act.keyScenes.join('；') : '',
  })
  const text = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
  return extractJsonFromMarkdown(text) || []
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

  if (!await canExecuteStep(params.id, 'STORYBOARD')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const body = await _req.json().catch(() => ({}))
  const force = body?.force === true
  const action: 'generate-prompts' | 'generate-images' | 'generate-act-images' = body?.action || 'generate-images'

  // === generate-prompts: 只生成分镜提示词，不生成草图 ===
  if (action === 'generate-prompts') {
    try {
      console.log('[STORYBOARD-PROMPT] 收到 generate-prompts 请求')

      const framework = project.framework as any
      const acts = Array.isArray(framework?.acts) ? framework.acts : []
      const textClient = await getTextClient()

      // 动态遍历所有幕生成
      const actResults = await Promise.all(
        acts.map((act: any) => generateStoryboardByAct(textClient, framework, act))
      )
      const allShots = actResults.flat()
      if (!Array.isArray(allShots) || allShots.length === 0) {
        throw new Error('Failed to parse storyboard from LLM output')
      }

      // 构建提示词数组
      const prompts = allShots.map((shot, i) => ({
        id: `prompt_${shot.shotId || i + 1}`,
        chineseDesc: shot.description || '',
        englishPrompt: `${shot.cameraMove || '固定'} | ${shot.duration || 5}s | ${shot.description || ''}`,
        target: `shot_${shot.shotId || i + 1}`,
        shotId: shot.shotId || String(i + 1),
        actNumber: shot.actNumber,
        cameraMove: shot.cameraMove,
        duration: shot.duration,
        characters: shot.characters || [],
        sceneName: shot.sceneName,
      }))

      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: 'PENDING' as any,
          outputData: {
            ...(step.outputData as any || {}),
            prompts,
            shots: allShots,
            mode: body?.mode || 'keyframe',
          },
        },
      })

      console.log(`[STORYBOARD-PROMPT] 生成 ${prompts.length} 条提示词，等待用户确认`)
      return NextResponse.json({ success: true, status: 'PROMPT_READY', prompts, shots: allShots })
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || /aborted|timeout|timed out/i.test(e?.message || '')
      const errorMessage = isAbort
        ? '提示词生成超时（模型响应较慢），请稍后重试'
        : e.message
      console.error(`[STORYBOARD-PROMPT] 失败: ${errorMessage}`, e?.stack?.slice(0, 300))
      await failStep(step.id, errorMessage)
      return NextResponse.json({ error: 'API_001', message: errorMessage }, { status: 500 })
    }
  }

  // === generate-images: 读取已保存提示词，生成草图 ===
  if (action === 'generate-images') {
    const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

    const aspectRatio = body?.aspectRatio || '16:9'
    const imageModel = body?.imageModel
    console.log(`[ASPECT-RATIO] [STORYBOARD-IMAGE] 用户选择比例: ${aspectRatio}`)
    console.log(`[MODEL-SELECT] [STORYBOARD-IMAGE] 用户选择模型: ${imageModel || '默认'}`)

    const existingOutput = (step.outputData as any) || {}
    const prompts = existingOutput.prompts || []
    const allShots = existingOutput.shots || []
    console.log('[STORYBOARD-IMAGE] existingOutput keys:', Object.keys(existingOutput))
    console.log('[STORYBOARD-IMAGE] prompts count:', prompts.length, 'shots count:', allShots.length)
    // prompts 为空时，自动先生成分镜提示词（与 generate-prompts 逻辑相同）
    let currentAllShots = allShots
    let currentPrompts = prompts
    if (prompts.length === 0) {
      console.log('[STORYBOARD-IMAGE] No prompts found, auto-generating prompts first...')
      const framework = project.framework as any
      const acts = Array.isArray(framework?.acts) ? framework.acts : []
      const textClient = await getTextClient()
      const actResults = await Promise.all(
        acts.map((act: any) => generateStoryboardByAct(textClient, framework, act))
      )
      currentAllShots = actResults.flat()
      if (!Array.isArray(currentAllShots) || currentAllShots.length === 0) {
        return NextResponse.json({ error: 'API_001', message: '生成分镜表失败，请稍后重试' }, { status: 500 })
      }
      currentPrompts = currentAllShots.map((shot, i) => ({
        id: `prompt_${shot.shotId || i + 1}`,
        chineseDesc: shot.description || '',
        englishPrompt: `${shot.cameraMove || '固定'} | ${shot.duration || 5}s | ${shot.description || ''}`,
        target: `shot_${shot.shotId || i + 1}`,
        shotId: shot.shotId || String(i + 1),
        actNumber: shot.actNumber,
        cameraMove: shot.cameraMove,
        duration: shot.duration,
        characters: shot.characters || [],
        sceneName: shot.sceneName,
      }))
      // 将生成的 prompts/shots 暂存到 step（不完成 step，保留 PENDING 状态）
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: 'PENDING' as any,
          outputData: {
            ...existingOutput,
            prompts: currentPrompts,
            shots: currentAllShots,
            mode: body?.mode || existingOutput.mode || 'keyframe',
          },
        },
      })
      console.log(`[STORYBOARD-IMAGE] Auto-generated ${currentPrompts.length} prompts, proceeding to generate images...`)
    }

    if (force) {
      console.log('[STORYBOARD-IMAGE] force=true, clearing old assets')
      await prisma.asset.deleteMany({
        where: { projectId: params.id, step: { stepType: 'STORYBOARD' } }
      })
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: 'PENDING' as any, outputData: existingOutput, errorMessage: null },
      })
    }

    await startStep(step.id)

    try {
      // 比例映射为 SVG 尺寸
      const sizeMap: Record<string, { w: number; h: number }> = {
        '16:9': { w: 1024, h: 576 },
        '9:16': { w: 576, h: 1024 },
        '1:1': { w: 1024, h: 1024 },
        '4:3': { w: 1024, h: 768 },
        '3:4': { w: 768, h: 1024 },
        '21:9': { w: 1344, h: 576 },
      }
      const { w: svgW, h: svgH } = sizeMap[aspectRatio] || sizeMap['16:9']

      const shotAssets = []
      for (const promptItem of currentPrompts) {
        const shot = currentAllShots.find((s: any) => s.shotId === promptItem.shotId) || {}
        const charColors = (promptItem.characters || []).map((cid: string, idx: number) => {
          const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6']
          return { id: cid, color: colors[idx % colors.length] }
        })

        const safeDesc = (promptItem.chineseDesc || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')

        const svg = `
          <svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <style>
                @font-face {
                  font-family: 'LocalNoto';
                  src: local('Noto Sans SC'), local('WenQuanYi Zen Hei'), local('WenQuanYi Micro Hei'),
                       local('Microsoft YaHei'), local('SimHei'), local('PingFang SC'),
                       local('Hiragino Sans GB'), local('Droid Sans Fallback');
                }
                .cn { font-family: 'LocalNoto', 'Noto Sans SC', 'WenQuanYi Zen Hei', 'WenQuanYi Micro Hei',
                      'Microsoft YaHei', 'SimHei', 'PingFang SC', 'Hiragino Sans GB',
                      'Droid Sans Fallback', system-ui, sans-serif; }
              </style>
            </defs>
            <rect width="100%" height="100%" fill="#f8f9fa"/>
            <text x="50%" y="10%" class="cn" font-size="24" fill="#333" text-anchor="middle">分镜 ${promptItem.shotId}</text>
            <text x="50%" y="20%" class="cn" font-size="16" fill="#666" text-anchor="middle">${promptItem.cameraMove || '固定'} | 第${promptItem.actNumber}幕 | ${promptItem.duration || 5}秒</text>
            ${charColors.map((c: any, i: number) =>
              `<circle cx="${200 + i * 300}" cy="300" r="80" fill="${c.color}" opacity="0.3" stroke="${c.color}" stroke-width="4"/>
               <text x="${200 + i * 300}" y="300" class="cn" font-size="20" fill="${c.color}" text-anchor="middle" dy=".3em">角色${i + 1}</text>`
            ).join('')}
            <rect x="50" y="${svgH - 126}" width="${svgW - 100}" height="80" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="8,4"/>
            <text x="50%" y="${svgH - 86}" class="cn" font-size="14" fill="#333" text-anchor="middle">${safeDesc}</text>
          </svg>
        `
        const buffer = await sharp(Buffer.from(svg)).png().toBuffer()
        const storageKey = `projects/${params.id}/storyboard/${promptItem.shotId}.png`
        await uploadFile(storageKey, buffer, 'image/png')
        const url = await getSignedFileUrl(storageKey, 3600)

        const asset = await prisma.asset.create({
          data: {
            projectId: params.id,
            stepId: step.id,
            type: 'IMAGE',
            mimeType: 'image/png',
            storageKey,
            url,
            metadata: { shotId: promptItem.shotId, type: 'storyboard', characters: promptItem.characters, duration: promptItem.duration, actNumber: promptItem.actNumber, aspectRatio },
          }
        })
        shotAssets.push({ shotId: promptItem.shotId, assetId: asset.id, url, actNumber: promptItem.actNumber })
      }

      // 从 project.framework 读取 acts 用于动态 actsSummary
      const framework = project.framework as any
      const fwActs = Array.isArray(framework?.acts) ? framework.acts : []
      const actsSummary = fwActs.length > 0
        ? fwActs.map((act: any) => ({
            actNo: act.actNo || act.actNumber,
            title: act.title || `第${act.actNo || act.actNumber}幕`,
            shotCount: currentAllShots.filter((s: any) => s.actNumber === (act.actNo || act.actNumber)).length,
            duration: 0,
          }))
        : []

      const outputData = {
        shots: currentAllShots,
        prompts: currentPrompts,
        shotAssets: shotAssets,
        mode: existingOutput.mode || 'keyframe',
        aspectRatio,
        imageModel: imageModel || 'gpt-image-2',
        actsSummary,
      }

      await completeStep(step.id, outputData)
      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[STORYBOARD-IMAGE] 用户确认，开始生图，共 ${currentPrompts.length} 条，比例 ${aspectRatio}，模型 ${imageModel || '默认'}`)
      return NextResponse.json({ success: true, data: { shots: currentAllShots, count: currentAllShots.length } })
    } catch (e: any) {
      await failStep(step.id, e.message)
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === generate-act-images: 按幕增量生成真实 AI 图片（异步队列：每次只生成1个shot）===
  if (action === 'generate-act-images') {
    const actNumber = body?.actNumber
    if (typeof actNumber !== 'number') {
      return NextResponse.json({ error: 'VALIDATION_001', message: 'actNumber 必填且为数字' }, { status: 400 })
    }

    const shotId = body?.shotId as string | undefined
    const aspectRatio = body?.aspectRatio || '16:9'
    const imageModel = body?.imageModel
    console.log(`[STORYBOARD-ACT] 开始生成第 ${actNumber} 幕，shotId: ${shotId || 'auto'}，比例: ${aspectRatio}，模型: ${imageModel || '默认'}`)

    const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

    const existingOutput = (step.outputData as any) || {}
    const prompts = existingOutput.prompts || []
    const allShots = existingOutput.shots || []
    const existingShotAssets: Array<{ shotId: string; assetId: string; url: string }> = existingOutput.shotAssets || []
    const existingShotPrompts: Array<{ shotId: string; prompt: string; caption: string }> = existingOutput.shotPrompts || []

    const actPrompts = prompts.filter((p: any) => p.actNumber === actNumber)
    if (actPrompts.length === 0) {
      return NextResponse.json({ error: 'VALIDATION_002', message: `幕 ${actNumber} 没有待生成的镜头` }, { status: 400 })
    }

    const actShotIds = new Set(actPrompts.map((p: any) => p.shotId))

    // force=true 时清除该幕所有旧 assets（重新生图）
    let cleanedShotAssets = existingShotAssets
    if (body?.force === true) {
      console.log(`[STORYBOARD-ACT] force=true, 清除第 ${actNumber} 幕旧 assets`)
      const allAssets = await prisma.asset.findMany({
        where: { projectId: params.id, stepId: step.id }
      })
      const actAssets = allAssets.filter((a: any) => a.metadata?.actNumber === actNumber)
      for (const asset of actAssets) {
        await prisma.asset.delete({ where: { id: asset.id } }).catch(() => {})
      }
      cleanedShotAssets = existingShotAssets.filter((s: any) => !(s.actNumber === actNumber && actShotIds.has(s.shotId)))
    }

    try {
      const framework = project.framework as any
      const textClient = await getTextClient()

      // ===== 阶段 A：确保该幕所有 shot 都有生图提示词 =====
      const missingShotIds = actPrompts
        .map((p: any) => p.shotId)
        .filter((sid: string) => !existingShotPrompts.some((sp: any) => sp.shotId === sid))

      let currentShotPrompts = [...existingShotPrompts]

      if (missingShotIds.length > 0) {
        console.log(`[STORYBOARD-ACT] 阶段A: 为 ${missingShotIds.length} 个缺失镜头生成提示词`)
        const newPrompts = await Promise.all(
          missingShotIds.map(async (sid: string) => {
            const promptItem = actPrompts.find((p: any) => p.shotId === sid)!
            const shot = allShots.find((s: any) => s.shotId === sid) || {}

            const characterNames = (promptItem.characters || [])
              .map((cid: string) => {
                const char = framework?.characters?.find((c: any) => c.id === cid)
                return char ? `${char.name}(${cid})` : cid
              })
              .join('、')

            const llmPrompt = `基于以下分镜信息，生成一段适合 AI 图像生成模型的英文提示词（prompt）：

分镜描述：${shot.description || promptItem.chineseDesc || ''}
运镜方式：${shot.cameraMove || promptItem.cameraMove || '固定'}
场景：${shot.sceneName || promptItem.sceneName || ''}
时长：${shot.duration || promptItem.duration || 5}秒
涉及角色：${characterNames || '无'}

要求：
1. 提示词必须包含场景环境、角色动作、光影氛围、镜头感描述
2. 如果涉及角色，必须引用该角色的形象特征（从角色设定中提取），确保角色一致性
3. 提示词长度控制在 200-500 词，适合即梦/Flux/DALL-E 等模型
4. 同时生成一个中文描述（用于前端展示）
5. 输出必须是有效的 JSON 格式，不要包含任何其他文字：
{"prompt": "英文生图提示词...", "caption": "中文画面描述..."}`

            try {
              const resultText = await textClient.generate(llmPrompt, { temperature: 0.7, maxTokens: 2048 })
              const parsed = extractJsonFromMarkdown(resultText) || {}
              return {
                shotId: sid,
                prompt: parsed.prompt || promptItem.englishPrompt || '',
                caption: parsed.caption || promptItem.chineseDesc || '',
              }
            } catch (err: any) {
              console.error(`[STORYBOARD-ACT] 镜头 ${sid} 提示词生成失败:`, err.message)
              return {
                shotId: sid,
                prompt: promptItem.englishPrompt || '',
                caption: promptItem.chineseDesc || '',
              }
            }
          })
        )
        currentShotPrompts = [
          ...existingShotPrompts.filter((p: any) => !actShotIds.has(p.shotId)),
          ...newPrompts,
        ]

        // 立即保存 shotPrompts，避免重复生成
        await prisma.workflowStep.update({
          where: { id: step.id },
          data: {
            outputData: {
              ...existingOutput,
              shotPrompts: currentShotPrompts,
            },
          },
        })
        console.log(`[STORYBOARD-ACT] 阶段A完成: 已保存 ${currentShotPrompts.length} 条 shotPrompts`)
      }

      // ===== 阶段 B：每次只生成 1 个 shot 的图片 =====
      // 确定目标 shot（指定或自动找下一个未生成的）
      let targetShotId = shotId
      if (!targetShotId) {
        for (const promptItem of actPrompts) {
          const hasAsset = cleanedShotAssets.some((s: any) => s.shotId === promptItem.shotId && s.actNumber === actNumber)
          if (!hasAsset) {
            targetShotId = promptItem.shotId
            break
          }
        }
      }

      if (!targetShotId) {
        // 全部已生成
        const processedCount = actPrompts.length
        return NextResponse.json({
          success: true,
          data: {
            status: 'completed',
            actNumber,
            processedCount,
            totalCount: actPrompts.length,
            remainingCount: 0,
          }
        })
      }

      const shotPrompt = currentShotPrompts.find((p: any) => p.shotId === targetShotId)
      if (!shotPrompt) {
        return NextResponse.json({ error: 'VALIDATION_003', message: `镜头 ${targetShotId} 没有对应的提示词` }, { status: 400 })
      }

      // 删除该 shot 已有的 asset（覆盖生成，需同时匹配 shotId 和 actNumber）
      const allAssets = await prisma.asset.findMany({
        where: { projectId: params.id, stepId: step.id }
      })
      const oldAsset = allAssets.find((a: any) => a.metadata?.shotId === targetShotId && a.metadata?.actNumber === actNumber)
      if (oldAsset) {
        await prisma.asset.delete({ where: { id: oldAsset.id } }).catch(() => {})
      }

      let styleRefUrl = ''
      try {
        const ref = await getStyleRefUrl(params.id)
        styleRefUrl = ref.styleRefUrl
        console.log('[STORYBOARD-ACT] 风格参考图:', styleRefUrl.slice(0, 80))
      } catch (refErr: any) {
        console.warn('[STORYBOARD-ACT] 风格参考图获取失败:', refErr.message)
      }

      const characterAssets = await prisma.asset.findMany({
        where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
      })
      const characterImageUrls = characterAssets
        .map((a) => a.url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0)

      const refImages: string[] = []
      if (styleRefUrl) refImages.push(styleRefUrl)
      if (characterImageUrls.length > 0) refImages.push(...characterImageUrls)

      console.log(`[STORYBOARD-ACT] 阶段B: 生图 ${targetShotId}, prompt前80:`, shotPrompt.prompt.slice(0, 80))

      const { buffer, isMock, lastError } = await generateImage({
        model: imageModel || 'gpt-image-2',
        prompt: shotPrompt.prompt,
        referenceImages: refImages.length > 0 ? refImages : undefined,
        aspectRatio,
        watermark: false,
        sequentialImageGeneration: 'disabled',
        maxImages: 1,
      })

      const storageKey = `projects/${params.id}/storyboard/${actNumber}_${shotPrompt.shotId}_${Date.now()}.png`
      await uploadFile(storageKey, buffer, 'image/png')
      const url = await getSignedFileUrl(storageKey, 3600)

      const asset = await prisma.asset.create({
        data: {
          projectId: params.id,
          stepId: step.id,
          type: 'IMAGE',
          mimeType: 'image/png',
          storageKey,
          url,
          metadata: {
            shotId: shotPrompt.shotId,
            type: 'storyboard',
            actNumber,
            aspectRatio,
            imageModel: imageModel || 'gpt-image-2',
            prompt: shotPrompt.prompt,
            caption: shotPrompt.caption,
            isMock: !!isMock,
            mockReason: lastError || null,
          },
        }
      })

      // 合并 shotAssets
      const newShotAsset = { shotId: shotPrompt.shotId, assetId: asset.id, url, actNumber }
      const mergedShotAssets = [
        ...cleanedShotAssets.filter((s: any) => !(s.shotId === shotPrompt.shotId && s.actNumber === actNumber)),
        newShotAsset,
      ]

      const processedCount = mergedShotAssets.filter((s: any) => s.actNumber === actNumber && actShotIds.has(s.shotId)).length
      const remainingCount = actPrompts.length - processedCount

      const nextOutput = {
        ...existingOutput,
        shotAssets: mergedShotAssets,
        shotPrompts: currentShotPrompts,
        aspectRatio,
        imageModel: imageModel || 'gpt-image-2',
      }

      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: remainingCount === 0 && step.status === 'PENDING' ? 'COMPLETED' as any : step.status,
          outputData: nextOutput,
        },
      })

      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })

      console.log(`[STORYBOARD-ACT] 第 ${actNumber} 幕进度: ${processedCount}/${actPrompts.length}, 当前: ${targetShotId}, 剩余: ${remainingCount}`)
      return NextResponse.json({
        success: true,
        data: {
          status: remainingCount > 0 ? 'processing' : 'completed',
          currentShotId: targetShotId,
          processedCount,
          totalCount: actPrompts.length,
          remainingCount,
          actNumber,
        }
      })
    } catch (e: any) {
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
      console.error(`[STORYBOARD-ACT] 第 ${actNumber} 幕生成失败:`, e.message)
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === 默认兼容：无 action 时走原有完整流程 ===
  if (!force && step.status === 'COMPLETED' && step.outputData) {
    console.log('[STORYBOARD] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  if (force) {
    console.log('[STORYBOARD] force=true, clearing old assets')
    await prisma.asset.deleteMany({
      where: { projectId: params.id, step: { stepType: 'STORYBOARD' } }
    })
    const existingOutput = (step.outputData as any) || {}
    const preservedOutput = {
      prompts: existingOutput.prompts,
      shots: existingOutput.shots,
      mode: existingOutput.mode,
    }
    console.log('[STORYBOARD] force=true, preserved prompts count:', existingOutput.prompts?.length || 0)
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PENDING' as any, outputData: preservedOutput, errorMessage: null },
    })
  }

  await startStep(step.id)

  try {
    const framework = project.framework as any
    const acts = Array.isArray(framework?.acts) ? framework.acts : []

    // 动态遍历所有幕生成分镜
    const textClient = await getTextClient()
    const actResults = await Promise.all(
      acts.map((act: any) => generateStoryboardByAct(textClient, framework, act))
    )
    const allShots = actResults.flat()

    if (!Array.isArray(allShots) || allShots.length === 0) {
      throw new Error('Failed to parse storyboard from LLM output')
    }

    // 为每个 shot 生成分镜草图
    const shotAssets = []
    for (const shot of allShots) {
      const charColors = (shot.characters || []).map((cid: string, idx: number) => {
        const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6']
        return { id: cid, color: colors[idx % colors.length] }
      })

      const safeDesc = (shot.description || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

      const svg = `
        <svg width="1024" height="576" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <style>
              @font-face {
                font-family: 'LocalNoto';
                src: local('Noto Sans SC'), local('WenQuanYi Zen Hei'), local('WenQuanYi Micro Hei'),
                     local('Microsoft YaHei'), local('SimHei'), local('PingFang SC'),
                     local('Hiragino Sans GB'), local('Droid Sans Fallback');
              }
              .cn { font-family: 'LocalNoto', 'Noto Sans SC', 'WenQuanYi Zen Hei', 'WenQuanYi Micro Hei',
                    'Microsoft YaHei', 'SimHei', 'PingFang SC', 'Hiragino Sans GB',
                    'Droid Sans Fallback', system-ui, sans-serif; }
            </style>
          </defs>
          <rect width="100%" height="100%" fill="#f8f9fa"/>
          <text x="50%" y="10%" class="cn" font-size="24" fill="#333" text-anchor="middle">分镜 ${shot.shotId}</text>
          <text x="50%" y="20%" class="cn" font-size="16" fill="#666" text-anchor="middle">${shot.cameraMove || '固定'} | 第${shot.actNumber}幕 | ${shot.duration || 5}秒</text>
          ${charColors.map((c: any, i: number) =>
            `<circle cx="${200 + i * 300}" cy="300" r="80" fill="${c.color}" opacity="0.3" stroke="${c.color}" stroke-width="4"/>
             <text x="${200 + i * 300}" y="300" class="cn" font-size="20" fill="${c.color}" text-anchor="middle" dy=".3em">角色${i + 1}</text>`
          ).join('')}
          <rect x="50" y="450" width="924" height="80" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="8,4"/>
          <text x="50%" y="490" class="cn" font-size="14" fill="#333" text-anchor="middle">${safeDesc}</text>
        </svg>
      `
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer()

      const storageKey = `projects/${params.id}/storyboard/${shot.shotId}.png`
      await uploadFile(storageKey, buffer, 'image/png')
      const url = await getSignedFileUrl(storageKey, 3600)

      const asset = await prisma.asset.create({
        data: {
          projectId: params.id,
          stepId: step.id,
          type: 'IMAGE',
          mimeType: 'image/png',
          storageKey,
          url,
          metadata: { shotId: shot.shotId, type: 'storyboard', characters: shot.characters, duration: shot.duration, actNumber: shot.actNumber },
        }
      })
      shotAssets.push({ shot, assetId: asset.id, url })
    }

    const outputData = {
      shots: allShots,
      shotAssets: shotAssets.map((s) => ({ shotId: s.shot.shotId, assetId: s.assetId, actNumber: s.shot.actNumber })),
      // [WORKFLOW-FIX] 保存模式到 outputData
      mode: body?.mode || 'keyframe',
      actsSummary: acts.map((act: any) => ({
        actNo: act.actNo || act.actNumber,
        title: act.title || `第${act.actNo || act.actNumber}幕`,
        shotCount: allShots.filter((s: any) => s.actNumber === (act.actNo || act.actNumber)).length,
        duration: 0,
      })),
    }

    await completeStep(step.id, outputData)
    await logOperation({
      userId,
      projectId: params.id,
      workflowStepId: step.id,
      actionType: 'generate',
      cost: STEP_COSTS.storyboard,
      status: 'success',
    })
    return NextResponse.json({ success: true, data: { shots: allShots, count: allShots.length } })
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
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } },
    include: { resultAssets: true }
  })
  if (!step) return NextResponse.json({ status: 'not_found' })
  return NextResponse.json({ status: step.status, outputData: step.outputData, assets: step.resultAssets })
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

  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.shots)) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData: Record<string, any> = (step.outputData as Record<string, any>) || {}
  // Phase 2: 保留 mode 字段
  const nextOutputData: Record<string, any> = { ...outputData, shots: body.shots }
  if (body.mode !== undefined) {
    nextOutputData.mode = body.mode
  }

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: { outputData: nextOutputData }
  })

  // 如果任意 shot 已有 firstFrameUrl，标记首帧生成完成
  const hasFirstFrame = body.shots.some((s: any) => s.firstFrameUrl)
  if (hasFirstFrame) {
    await prisma.project.update({
      where: { id: params.id },
      data: { stepStoryboardFirstframeDone: true }
    })
  }

  console.log('[STORYBOARD-PATCH] 保存 shots 成功, 数量:', body.shots.length)
  return NextResponse.json({ success: true })
}
