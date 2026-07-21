export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { generateImage } from '@/lib/api-clients/xiaomi'
import { getStyleRefUrl, getProjectReferences } from '@/lib/style-ref'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { getProjectDefaultAspectRatio } from '@/lib/server/workflow-state'
import sharp from 'sharp'
import { IMAGE_MODELS } from '@/lib/models-config'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'
import { PROJECT_TAG_PROMPTS } from '@/lib/project-tags'

async function generateStoryboardByAct(textClient: any, framework: any, act: any, tagInstructions?: string) {
  const prompt = loadPromptTemplate('storyboard-act-dynamic', {
    USER_INPUT: JSON.stringify(framework),
    ACT_NUMBER: String(act.actNo || act.actNumber || 1),
    ACT_TITLE: act.title || `第${act.actNo || act.actNumber || 1}幕`,
    ACT_CONTENT: act.content || '',
    ESTIMATED_SHOTS: String(typeof act.estimatedShots === 'number' ? act.estimatedShots : 10),
    ACT_PACING: act.pacing || '张弛有度',
    KEY_SCENES: Array.isArray(act.keyScenes) ? act.keyScenes.join('；') : '',
    TAG_INSTRUCTIONS: tagInstructions || '',
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
    const pointsCheck = await checkPoints(GENERATION_COSTS.STORYBOARD_PROMPTS)
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

    try {
      console.log('[STORYBOARD-PROMPT] 收到 generate-prompts 请求')

      const framework = project.framework as any
      const acts = Array.isArray(framework?.acts) ? framework.acts : []
      const textClient = await getTextClient()

      const ideationStep = await prisma.workflowStep.findUnique({
        where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } },
      })
      const outputData: any = ideationStep?.outputData || {}
      const projectTag = outputData?.projectTag || ''
      const tagInstructions = projectTag && PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS]
        ? PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS].storyboard
        : ''

      const actResults = await Promise.all(
        acts.map((act: any) => generateStoryboardByAct(textClient, framework, act, tagInstructions))
      )
      let allShots = actResults.flat()
      if (!Array.isArray(allShots) || allShots.length === 0) {
        throw new Error('Failed to parse storyboard from LLM output')
      }

      // 规范化 shotId：缺失时按顺序补齐 shot_001, shot_002 ...
      allShots = allShots.map((s: any, i: number) => ({
        ...s,
        shotId: s.shotId || `shot_${String(i + 1).padStart(3, '0')}`,
      }))

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

      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[STORYBOARD-PROMPT] 生成 ${prompts.length} 条提示词，等待用户确认`)
      return NextResponse.json({ success: true, status: 'PROMPT_READY', prompts, shots: allShots })
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || /aborted|timeout|timed out/i.test(e?.message || '')
      const errorMessage = isAbort
        ? '提示词生成超时（模型响应较慢），请稍后重试'
        : e.message
      console.error(`[STORYBOARD-PROMPT] 失败: ${errorMessage}`, e?.stack?.slice(0, 300))
      await failStep(step.id, errorMessage)
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage })
      return NextResponse.json({ error: 'API_001', message: errorMessage }, { status: 500 })
    }
  }

  // === generate-images: 读取已保存提示词，生成草图 ===
  if (action === 'generate-images') {
    const defaultAspectRatio = await getProjectDefaultAspectRatio(params.id)
    const aspectRatio = body?.aspectRatio || defaultAspectRatio
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
      const promptPointsCheck = await checkPoints(GENERATION_COSTS.STORYBOARD_PROMPTS)
      if (!promptPointsCheck.ok) {
        return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
      }
      const framework = project.framework as any
      const acts = Array.isArray(framework?.acts) ? framework.acts : []
      const textClient = await getTextClient()

      const ideationOutput: any = (await prisma.workflowStep.findUnique({
        where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } },
      }))?.outputData || {}
      const projectTag2 = ideationOutput?.projectTag || ''
      const tagInstructions2 = projectTag2 && PROJECT_TAG_PROMPTS[projectTag2 as keyof typeof PROJECT_TAG_PROMPTS]
        ? PROJECT_TAG_PROMPTS[projectTag2 as keyof typeof PROJECT_TAG_PROMPTS].storyboard
        : ''

      const actResults = await Promise.all(
        acts.map((act: any) => generateStoryboardByAct(textClient, framework, act, tagInstructions2))
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
      await deductPointsAndLog(userId, promptPointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[STORYBOARD-IMAGE] Auto-generated ${currentPrompts.length} prompts, proceeding to generate images...`)
    }

    const pointsCheck = await checkPoints(GENERATION_COSTS.STORYBOARD_IMAGES)
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
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
      const shotsWithFirstFrame = []
      for (const promptItem of currentPrompts) {
        const shot = currentAllShots.find((s: any) => s.shotId === promptItem.shotId && s.actNumber === promptItem.actNumber) || {}
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
        shotsWithFirstFrame.push({ ...shot, firstFrameUrl: url })
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
        shots: shotsWithFirstFrame,
        prompts: currentPrompts,
        shotAssets: shotAssets,
        mode: existingOutput.mode || 'keyframe',
        aspectRatio,
        imageModel: imageModel || 'gpt-image-2',
        actsSummary,
      }

      await completeStep(step.id, outputData)
      // 占位图也是首帧，标记至少一个首帧已生成
      await prisma.project.update({
        where: { id: params.id },
        data: { stepStoryboardFirstframeDone: true },
      })
      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[STORYBOARD-IMAGE] 用户确认，开始生图，共 ${currentPrompts.length} 条，比例 ${aspectRatio}，模型 ${imageModel || '默认'}`)
      return NextResponse.json({ success: true, data: { shots: shotsWithFirstFrame, count: shotsWithFirstFrame.length } })
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
    const defaultAspectRatio = await getProjectDefaultAspectRatio(params.id)
    const aspectRatio = body?.aspectRatio || defaultAspectRatio
    const imageModel = body?.imageModel
    console.log(`[STORYBOARD-ACT] 开始生成第 ${actNumber} 幕，shotId: ${shotId || 'auto'}，比例: ${aspectRatio}，模型: ${imageModel || '默认'}`)

    const pointsCheck = await checkPoints(GENERATION_COSTS.STORYBOARD_ACT_IMAGE)
    if (!pointsCheck.ok) {
      return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
    }

    const existingOutput = (step.outputData as any) || {}
    const prompts = (existingOutput.prompts || []).map((p: any, i: number) => ({
      ...p,
      shotId: p.shotId || `shot_${String(i + 1).padStart(3, '0')}`,
    }))
    const allShots = (existingOutput.shots || []).map((s: any, i: number) => ({
      ...s,
      shotId: s.shotId || `shot_${String(i + 1).padStart(3, '0')}`,
    }))
    const existingShotAssets: Array<{ shotId: string; assetId: string; url: string; actNumber?: number }> = existingOutput.shotAssets || []
    const existingShotPrompts: Array<{ shotId: string; actNumber?: number; prompt: string; caption: string }> = existingOutput.shotPrompts || []

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
      // 使用 (actNumber, shotId) 复合键隔离不同幕的同名镜头
      const promptKey = (p: any) => `${p.actNumber}|${p.shotId}`
      const existingPromptKeys = new Set(
        existingShotPrompts
          .filter((sp: any) => sp.actNumber === actNumber)
          .map(promptKey)
      )
      const missingShotIds = actPrompts
        .filter((p: any) => !existingPromptKeys.has(promptKey(p)))
        .map((p: any) => p.shotId)

      let currentShotPrompts = [...existingShotPrompts]

      if (missingShotIds.length > 0) {
        console.log(`[STORYBOARD-ACT] 阶段A: 为 ${missingShotIds.length} 个缺失镜头生成提示词`, missingShotIds)

        const sbRefs = await getProjectReferences(params.id).catch(() => [])
        const sbRefLabels = sbRefs.filter((r: any) => r.labels?.length).flatMap((r: any) => r.labels)
        const sbRefHint = sbRefs.length > 0
          ? `\n6. 如果有用户上传的 ${sbRefs.length} 张参考图${sbRefLabels.length > 0 ? `（标签：${sbRefLabels.join('、')}）` : ''}，提示词中可以直接引用'参考图1中的角色'，无需重新描述外貌特征`
          : ''

        const newPrompts = await Promise.all(
          missingShotIds.map(async (sid: string) => {
            const promptItem = actPrompts.find((p: any) => p.shotId === sid)!
            const shot = allShots.find((s: any) => s.shotId === sid && s.actNumber === actNumber) || {}

            const characterNames = (promptItem.characters || [])
              .map((cid: string) => {
                const char = framework?.characters?.find((c: any) => c.id === cid)
                return char ? `${char.name}(${cid})` : cid
              })
              .join('、')

            const llmPrompt = `基于以下分镜信息，生成一段适合 AI 图像生成模型的英文提示词（prompt）。这张图片将直接作为视频首帧，必须是单张完整画面，不能是拼接/分屏/多格漫画。

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
5. 【最高优先级】必须输出单张完整画面（single full frame），禁止出现以下任何形式：分屏 split-screen、多格 panels、漫画分镜 comic layout、拼贴 collage、三联画 triptych、双联画 diptych、时间轴 timeline、前后对比 before/after、白天黑夜并列 day-night split。只描述一个单一瞬间的单一画面。
6. 输出必须是有效的 JSON 格式，不要包含任何其他文字：
{"prompt": "英文生图提示词...", "caption": "中文画面描述..."}${sbRefHint}`

            try {
              const resultText = await textClient.generate(llmPrompt, { temperature: 0.7, maxTokens: 2048 })
              const parsed = extractJsonFromMarkdown(resultText) || {}
              return {
                shotId: sid,
                actNumber,
                prompt: parsed.prompt || promptItem.englishPrompt || '',
                caption: parsed.caption || promptItem.chineseDesc || '',
              }
            } catch (err: any) {
              console.error(`[STORYBOARD-ACT] 镜头 ${sid} 提示词生成失败:`, err.message)
              return {
                shotId: sid,
                actNumber,
                prompt: promptItem.englishPrompt || '',
                caption: promptItem.chineseDesc || '',
              }
            }
          })
        )

        // 合并提示词：以新提示词覆盖同 (actNumber, shotId)，保留其他幕的提示词
        const promptMap = new Map(existingShotPrompts.map((p: any) => [promptKey(p), p]))
        for (const p of newPrompts) promptMap.set(promptKey(p), p)
        currentShotPrompts = Array.from(promptMap.values())

        // 立即保存 shotPrompts，同时规范化 shots/prompts，避免前后端 shotId 不一致
        await prisma.workflowStep.update({
          where: { id: step.id },
          data: {
            outputData: {
              ...existingOutput,
              prompts,
              shots: allShots,
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

      let shotPrompt = currentShotPrompts.find((p: any) => p.actNumber === actNumber && p.shotId === targetShotId)
      if (!shotPrompt) {
        // 兼容旧数据：允许无 actNumber 的提示词回退
        shotPrompt = currentShotPrompts.find((p: any) => p.actNumber === undefined && p.shotId === targetShotId)
      }
      if (!shotPrompt) {
        // 防御性回退：从 actPrompts 直接构造（防止 shotId 类型/格式不一致导致找不到）
        const fallbackPromptItem = actPrompts.find((p: any) => p.shotId === targetShotId)
        if (fallbackPromptItem) {
          console.warn(`[STORYBOARD-ACT] 未找到 ${targetShotId} 的 shotPrompt，使用 actPrompt 回退`)
          shotPrompt = {
            shotId: targetShotId,
            actNumber,
            prompt: fallbackPromptItem.englishPrompt || '',
            caption: fallbackPromptItem.chineseDesc || '',
          }
        }
      }
      if (!shotPrompt) {
        console.error(`[STORYBOARD-ACT] 幕 ${actNumber} 镜头 ${targetShotId} 无可用提示词，currentShotPrompts:`, currentShotPrompts.map((p: any) => `${p.actNumber ?? '?'}/${p.shotId}`), 'actPrompts:', actPrompts.map((p: any) => `${p.actNumber}/${p.shotId}`))
        return NextResponse.json({ error: 'VALIDATION_003', message: `镜头 ${targetShotId} 没有对应的提示词` }, { status: 400 })
      }

      // 查找上一个镜头（同幕内），用于画面连贯性
      let previousShotImageUrl: string | null = null
      let previousShotDesc: string | null = null
      const targetIndex = actPrompts.findIndex((p: any) => p.shotId === targetShotId)
      if (targetIndex > 0) {
        const prevPrompt = actPrompts[targetIndex - 1]
        const prevAsset = cleanedShotAssets.find((s: any) => s.shotId === prevPrompt.shotId && s.actNumber === actNumber)
        if (prevAsset?.url) {
          previousShotImageUrl = prevAsset.url
          previousShotDesc = allShots.find((s: any) => s.shotId === prevPrompt.shotId && s.actNumber === actNumber)?.description || prevPrompt.chineseDesc || ''
          console.log(`[STORYBOARD-ACT] 上一镜头 ${prevPrompt.shotId} 已有图片，用作连贯参考`)
        }
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

      const refs = await getProjectReferences(params.id).catch(() => [])
      const userRefUrls = refs.filter(r => r.url).map(r => r.url)

      const refImages: string[] = []
      if (previousShotImageUrl) refImages.push(previousShotImageUrl)
      if (characterImageUrls.length > 0) refImages.push(...characterImageUrls)
      if (styleRefUrl) refImages.push(styleRefUrl)
      if (userRefUrls.length > 0) refImages.push(...userRefUrls)

      // 如果有上一镜头参考图，增强 prompt 以保持画面连贯性
      let finalPrompt = shotPrompt.prompt
      if (previousShotImageUrl && previousShotDesc) {
        const currentShot = allShots.find((s: any) => s.shotId === targetShotId)
        const currentDesc = currentShot?.description || shotPrompt.caption || ''
        const charSame = currentShot?.characters?.join(',') === actPrompts[targetIndex]?.characters?.join(',')
        const hint = charSame
          ? 'Maintain the same characters, environment, and lighting as the reference image. Only adjust camera angle, framing, and character poses as described.'
          : 'Maintain the same environment and lighting as the reference image, but apply the character changes described below.'
        finalPrompt = `[Continuity from previous shot: ${previousShotDesc.slice(0, 80)}] ${hint}\n\nCurrent shot: ${currentDesc}\n\n${shotPrompt.prompt}`
      }

      // 强制单帧：追加负面约束，防止模型输出分屏/多格/拼贴
      const singleFrameGuard = ' Single full frame only. Absolutely no split-screen, multi-panel, collage, triptych, diptych, comic layout, before-and-after comparison, or timeline sequence. One image, one moment.'
      const guardedPrompt = finalPrompt + singleFrameGuard

      console.log(`[STORYBOARD-ACT] 阶段B: 生图 ${targetShotId}, prompt前80:`, guardedPrompt.slice(0, 80))

      const { buffer, isMock, lastError } = await generateImage({
        model: imageModel || 'gpt-image-2',
        prompt: guardedPrompt,
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

      // 合并 shotAssets 并回写对应 shot 的 firstFrameUrl
      const newShotAsset = { shotId: shotPrompt.shotId, assetId: asset.id, url, actNumber }
      const mergedShotAssets = [
        ...cleanedShotAssets.filter((s: any) => !(s.shotId === shotPrompt.shotId && s.actNumber === actNumber)),
        newShotAsset,
      ]
      const mergedShots = allShots.map((s: any) =>
        s.shotId === shotPrompt.shotId && s.actNumber === actNumber ? { ...s, firstFrameUrl: url } : s
      )

      const processedCount = mergedShotAssets.filter((s: any) => s.actNumber === actNumber && actShotIds.has(s.shotId)).length
      const remainingCount = actPrompts.length - processedCount

      const nextOutput = {
        ...existingOutput,
        prompts,
        shots: mergedShots,
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

      // 只要生成过任一真实首帧，就解锁尾帧/直生视频步骤
      await prisma.project.update({
        where: { id: params.id },
        data: { stepStoryboardFirstframeDone: true },
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

  const totalCost = GENERATION_COSTS.STORYBOARD_PROMPTS + GENERATION_COSTS.STORYBOARD_IMAGES
  const pointsCheck = await checkPoints(totalCost)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
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
    let allShots = actResults.flat()

    if (!Array.isArray(allShots) || allShots.length === 0) {
      throw new Error('Failed to parse storyboard from LLM output')
    }

    // 规范化 shotId：缺失时按顺序补齐 shot_001, shot_002 ...
    allShots = allShots.map((s: any, i: number) => ({
      ...s,
      shotId: s.shotId || `shot_${String(i + 1).padStart(3, '0')}`,
    }))

    // 为每个 shot 生成分镜草图
    const shotAssets = []
    const shotsWithFirstFrame = []
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
      shotAssets.push({ shotId: shot.shotId, assetId: asset.id, url, actNumber: shot.actNumber })
      shotsWithFirstFrame.push({ ...shot, firstFrameUrl: url })
    }

    const outputData = {
      shots: shotsWithFirstFrame,
      shotAssets: shotAssets,
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
    // 占位图也是首帧，标记至少一个首帧已生成
    await prisma.project.update({
      where: { id: params.id },
      data: { stepStoryboardFirstframeDone: true },
    })
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
    return NextResponse.json({ success: true, data: { shots: shotsWithFirstFrame, count: shotsWithFirstFrame.length } })
  } catch (e: any) {
    await failStep(step.id, e.message)
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
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
