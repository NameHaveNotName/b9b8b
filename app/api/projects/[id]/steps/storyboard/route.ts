import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import sharp from 'sharp'
import { IMAGE_MODELS } from '@/lib/models-config'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'

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

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
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
  const action: 'generate-prompts' | 'generate-images' = body?.action || 'generate-images'

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
      await failStep(step.id, e.message)
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
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
    if (prompts.length === 0) {
      return NextResponse.json({ error: 'No prompts found. Please call generate-prompts first.' }, { status: 400 })
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
      for (const promptItem of prompts) {
        const shot = allShots.find((s: any) => s.shotId === promptItem.shotId) || {}
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
            <rect width="100%" height="100%" fill="#f8f9fa"/>
            <text x="50%" y="10%" font-family="system-ui, sans-serif" font-size="24" fill="#333" text-anchor="middle">分镜 ${promptItem.shotId}</text>
            <text x="50%" y="20%" font-family="system-ui, sans-serif" font-size="16" fill="#666" text-anchor="middle">${promptItem.cameraMove || '固定'} | 第${promptItem.actNumber}幕 | ${promptItem.duration || 5}秒</text>
            ${charColors.map((c: any, i: number) =>
              `<circle cx="${200 + i * 300}" cy="300" r="80" fill="${c.color}" opacity="0.3" stroke="${c.color}" stroke-width="4"/>
               <text x="${200 + i * 300}" y="300" font-family="system-ui, sans-serif" font-size="20" fill="${c.color}" text-anchor="middle" dy=".3em">角色${i + 1}</text>`
            ).join('')}
            <rect x="50" y="${svgH - 126}" width="${svgW - 100}" height="80" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="8,4"/>
            <text x="50%" y="${svgH - 86}" font-family="system-ui, sans-serif" font-size="14" fill="#333" text-anchor="middle">${safeDesc}</text>
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
        shotAssets.push({ shotId: promptItem.shotId, assetId: asset.id, url })
      }

      // 从 project.framework 读取 acts 用于动态 actsSummary
      const framework = project.framework as any
      const fwActs = Array.isArray(framework?.acts) ? framework.acts : []
      const actsSummary = fwActs.length > 0
        ? fwActs.map((act: any) => ({
            actNo: act.actNo || act.actNumber,
            title: act.title || `第${act.actNo || act.actNumber}幕`,
            shotCount: allShots.filter((s: any) => s.actNumber === (act.actNo || act.actNumber)).length,
            duration: 0,
          }))
        : []

      const outputData = {
        shots: allShots,
        shotAssets: shotAssets,
        mode: existingOutput.mode || 'keyframe',
        aspectRatio,
        imageModel: imageModel || IMAGE_MODELS.primary,
        actsSummary,
      }

      await completeStep(step.id, outputData)
      await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
      console.log(`[STORYBOARD-IMAGE] 用户确认，开始生图，共 ${prompts.length} 条，比例 ${aspectRatio}，模型 ${imageModel || '默认'}`)
      return NextResponse.json({ success: true, data: { shots: allShots, count: allShots.length } })
    } catch (e: any) {
      await failStep(step.id, e.message)
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
      return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
    }
  }

  // === 默认兼容：无 action 时走原有完整流程 ===
  if (!force && step.status === 'COMPLETED' && step.outputData) {
    console.log('[STORYBOARD] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  if (force) {
    console.log('[STORYBOARD] force=true, resetting step and clearing old assets')
    await prisma.asset.deleteMany({
      where: { projectId: params.id, step: { stepType: 'STORYBOARD' } }
    })
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PENDING' as any, outputData: {}, errorMessage: null },
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
          <rect width="100%" height="100%" fill="#f8f9fa"/>
          <text x="50%" y="10%" font-family="system-ui, sans-serif" font-size="24" fill="#333" text-anchor="middle">分镜 ${shot.shotId}</text>
          <text x="50%" y="20%" font-family="system-ui, sans-serif" font-size="16" fill="#666" text-anchor="middle">${shot.cameraMove || '固定'} | 第${shot.actNumber}幕 | ${shot.duration || 5}秒</text>
          ${charColors.map((c: any, i: number) =>
            `<circle cx="${200 + i * 300}" cy="300" r="80" fill="${c.color}" opacity="0.3" stroke="${c.color}" stroke-width="4"/>
             <text x="${200 + i * 300}" y="300" font-family="system-ui, sans-serif" font-size="20" fill="${c.color}" text-anchor="middle" dy=".3em">角色${i + 1}</text>`
          ).join('')}
          <rect x="50" y="450" width="924" height="80" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="8,4"/>
          <text x="50%" y="490" font-family="system-ui, sans-serif" font-size="14" fill="#333" text-anchor="middle">${safeDesc}</text>
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
      shotAssets: shotAssets.map((s) => ({ shotId: s.shot.shotId, assetId: s.assetId })),
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
    return NextResponse.json({ success: true, data: { shots: allShots, count: allShots.length } })
  } catch (e: any) {
    await failStep(step.id, e.message)
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

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
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

  console.log('[STORYBOARD-PATCH] 保存 shots 成功, 数量:', body.shots.length)
  return NextResponse.json({ success: true })
}
