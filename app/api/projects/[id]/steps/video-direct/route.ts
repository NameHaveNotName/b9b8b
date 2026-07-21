export const dynamic = 'force-dynamic'

// Vercel Serverless 强制使用 /tmp 作为临时目录，防止构建缓存导致旧 makeTempDir 回退到 /var/task/.temp
process.env.TEMP_DIR = '/tmp'

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { startStep, canExecuteStep } from '@/lib/workflow-executor'
import { getProjectDefaultAspectRatio } from '@/lib/workflow-state'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS, calculateBatchCost } from '@/lib/points-config'

/** 获取 storyboard shots 和 keyframes */
async function getStoryboardAndKeyframes(projectId: string) {
  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'STORYBOARD' } },
  })
  const shots = (storyboardStep?.outputData as any)?.shots || []

  const keyframeStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'KEYFRAMES' } },
  })
  const keyframesData = keyframeStep?.outputData as any || {}
  const keyframes = keyframesData.keyframes || keyframesData.results || []

  return { shots, keyframes }
}

/** 清理因上次服务器超时而卡在 generating 的片段 */
async function resetStaleGeneratingSegments(projectId: string, staleMinutes = 15) {
  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000)
  const result = await prisma.videoSegment.updateMany({
    where: {
      projectId,
      stepName: 'VIDEO_DIRECT',
      status: 'generating',
      updatedAt: { lt: staleThreshold },
    },
    data: { status: 'failed', errorMessage: '生成超时，请重试' },
  })
  if (result.count > 0) {
    console.log(`[VIDEO-DIRECT] 清理 ${result.count} 个超时卡住的生成中片段`)
  }
  return result.count
}

/** 后台生成单个 segment */
async function backgroundGenerateDirectSegment(
  segmentId: string,
  projectId: string,
  prompt: string,
  firstFrameUrl: string,
  lastFrameUrl: string | null,
  duration: number,
  videoModel?: string,
  aspectRatio?: string
) {
  try {
    console.log(`[DIRECT-SEGMENT-BG] 开始生成 segmentId=${segmentId}`)
    const { generateOneVideoSegment } = await import('@/lib/video-segment-utils')
    const result = await generateOneVideoSegment({
      segmentId,
      projectId,
      stepName: 'VIDEO_DIRECT',
      prompt,
      imageUrl: firstFrameUrl,
      duration,
      videoModel,
      aspectRatio,
    })

    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        videoUrl: result.url,
        storageKey: result.storageKey,
        status: 'completed',
        duration: result.duration,
        isMock: result.isMock,
      },
    })

    await prisma.asset.create({
      data: {
        projectId,
        type: 'VIDEO',
        mimeType: 'video/mp4',
        storageKey: result.storageKey,
        url: result.url,
        metadata: {
          segmentId,
          duration: result.duration,
          isMock: result.isMock,
          stepType: 'VIDEO_DIRECT',
        },
      },
    })

    console.log(`[DIRECT-SEGMENT-BG] 完成 segmentId=${segmentId} isMock=${result.isMock}`)
  } catch (e: any) {
    console.error(`[DIRECT-SEGMENT-BG] 失败 segmentId=${segmentId}:`, e?.message)
    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        status: 'failed',
        errorMessage: (e?.message || '生成失败').slice(0, 200),
      },
    })
  }
}

/** 后台合成视频 */
async function backgroundComposeDirectVideo(projectId: string) {
  try {
    console.log(`[DIRECT-COMPOSE-BG] 开始合成 projectId=${projectId}`)
    const segments = await prisma.videoSegment.findMany({
      where: { projectId, stepName: 'VIDEO_DIRECT', status: 'completed' },
      orderBy: { sequence: 'asc' },
    })

    if (segments.length === 0) {
      throw new Error('没有已完成的片段可合成')
    }

    // 从 KEYFRAMES 或 STYLE 步骤读取用户选择的画面比例
    const keyframeStep = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: 'KEYFRAMES' } },
    })
    const defaultAspectRatio = await getProjectDefaultAspectRatio(projectId)
    const aspectRatio = (keyframeStep?.outputData as any)?.aspectRatio || defaultAspectRatio
    console.log(`[DIRECT-COMPOSE-BG] 使用比例: ${aspectRatio}`)

    const { composeVideo } = await import('@/lib/video-segment-utils')
    const result = await composeVideo({
      projectId,
      stepName: 'VIDEO_DIRECT',
      segments: segments.map((s) => ({
        id: s.id,
        storageKey: s.storageKey,
        videoUrl: s.videoUrl,
        duration: s.duration,
      })),
      aspectRatio,
    })

    console.log(`[DIRECT-COMPOSE-BG] 合成完成 videoUrl=${result.videoUrl}`)
  } catch (e: any) {
    console.error(`[DIRECT-COMPOSE-BG] 合成失败:`, e?.message)
  }
}

// ============================================================
// POST: 主入口（支持 action 分发）
// ============================================================
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

  if (!await canExecuteStep(params.id, 'VIDEO_DIRECT')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  let step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'VIDEO_DIRECT' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const action = body?.action || 'generate-segment-prompts'
  const videoModel = body?.videoModel

  console.log(`[VIDEO-DIRECT-POST] action=${action} projectId=${params.id}`)

  // -------------------- 新版：生成 Segment Prompts --------------------
  if (action === 'generate-segment-prompts') {
    return handleGenerateDirectPrompts(params.id, step.id, userId)
  }

  // -------------------- 新版：单段生成 --------------------
  if (action === 'generate-segment-video') {
    return handleGenerateDirectSegment(params.id, step.id, body, userId)
  }

  // -------------------- 新版：批量生成 --------------------
  if (action === 'generate-all-segments') {
    return handleGenerateAllDirectSegments(params.id, step.id, body, userId)
  }

  // -------------------- 新版：合成视频 --------------------
  if (action === 'compose-video') {
    return handleComposeDirectVideo(params.id, step.id)
  }

  // -------------------- 新版：生成背景音乐 --------------------
  if (action === 'generate-bgm') {
    return handleGenerateDirectBgm(params.id, step.id, userId)
  }

  return NextResponse.json({ error: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }, { status: 400 })
}

// ============================================================
// 各 action 处理函数
// ============================================================

/** 生成 Segment Prompts */
async function handleGenerateDirectPrompts(projectId: string, stepId: string, userId: string) {
  const pointsCheck = await checkPoints(GENERATION_COSTS.IDEA_DIFFUSION)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    const { shots } = await getStoryboardAndKeyframes(projectId)
    if (shots.length === 0) {
      return NextResponse.json({ error: 'NO_STORYBOARD', message: '未找到分镜数据' }, { status: 400 })
    }

    const { generateSegmentPrompts } = await import('@/lib/video-segment-utils')
    const segments = await generateSegmentPrompts(projectId, 'VIDEO_DIRECT', shots)

    await prisma.workflowStep.update({
      where: { id: stepId },
      data: {
        status: 'PENDING' as any,
        outputData: {
          ...(await prisma.workflowStep.findUnique({ where: { id: stepId } }))?.outputData as any || {},
          segmentPromptsGenerated: true,
          segmentCount: segments.length,
        },
      },
    })

    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId, workflowStepId: stepId, success: true })

    return NextResponse.json({
      success: true,
      status: 'PROMPT_READY',
      segments,
      message: `已生成 ${segments.length} 个分镜的视频提示词`,
    })
  } catch (e: any) {
    console.error('[VIDEO-DIRECT-PROMPTS] 失败:', e)
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId, workflowStepId: stepId, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

/** 单段生成 */
async function handleGenerateDirectSegment(projectId: string, stepId: string, body: any, userId: string) {
  // 先清理上次超时卡住的片段（包括当前段）
  await resetStaleGeneratingSegments(projectId)

  const segmentId = body?.segmentId
  if (!segmentId) {
    return NextResponse.json({ error: 'MISSING_SEGMENT_ID' }, { status: 400 })
  }

  const segment = await prisma.videoSegment.findUnique({
    where: { id: segmentId },
  })
  if (!segment || segment.projectId !== projectId) {
    return NextResponse.json({ error: 'SEGMENT_NOT_FOUND' }, { status: 404 })
  }

  if (segment.status === 'generating') {
    return NextResponse.json({ success: true, message: '该片段正在生成中', status: 'generating' })
  }
  if (segment.status === 'completed') {
    return NextResponse.json({ success: true, message: '该片段已生成', status: 'completed' })
  }

  const pointsCheck = await checkPoints(GENERATION_COSTS.VIDEO_DIRECT_SEGMENT)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  const { shots, keyframes } = await getStoryboardAndKeyframes(projectId)
  const shot = shots[segment.sequence] || shots.find((s: any) => s.shotId === segment.shotId)
  const firstFrameUrl = shot?.firstFrameUrl || ''
  if (!firstFrameUrl) {
    return NextResponse.json({ error: 'NO_IMAGE', message: '该分镜没有可用的首帧' }, { status: 400 })
  }
  const kf = keyframes[segment.sequence] || keyframes.find((k: any) => k.shotId === segment.shotId)
  const lastFrameUrl = kf?.lastFrameUrl || null

  await prisma.videoSegment.update({
    where: { id: segmentId },
    data: { status: 'generating', errorMessage: null },
  })

  // 异步视频生成：先扣点，再启动后台任务
  await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId, workflowStepId: stepId, assetId: segmentId, success: true })

  const defaultAspectRatio = await getProjectDefaultAspectRatio(projectId)
  waitUntil(backgroundGenerateDirectSegment(
    segmentId,
    projectId,
    segment.prompt,
    firstFrameUrl,
    lastFrameUrl,
    segment.duration || 5,
    body?.videoModel,
    defaultAspectRatio
  ))

  return NextResponse.json({
    success: true,
    segmentId,
    status: 'generating',
    message: '片段生成已启动',
  })
}

/** 批量生成 */
async function handleGenerateAllDirectSegments(projectId: string, stepId: string, body: any, userId: string) {
  // 先清理上次超时卡住的片段
  const resetCount = await resetStaleGeneratingSegments(projectId)

  const pendingSegments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'VIDEO_DIRECT', status: 'pending' },
    orderBy: { sequence: 'asc' },
  })

  if (pendingSegments.length === 0) {
    return NextResponse.json({
      success: true,
      message: resetCount > 0 ? `已清理 ${resetCount} 个超时片段，当前没有待生成片段` : '没有待生成的片段',
      count: 0,
      resetCount,
    })
  }

  const batchCost = calculateBatchCost(GENERATION_COSTS.VIDEO_DIRECT_SEGMENT, pendingSegments.length)
  const pointsCheck = await checkPoints(batchCost)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId, workflowStepId: stepId, success: true })

  const { shots, keyframes } = await getStoryboardAndKeyframes(projectId)
  const defaultAspectRatio = await getProjectDefaultAspectRatio(projectId)

  waitUntil((async () => {
    for (const segment of pendingSegments) {
      const shot = shots.find((s: any) => s.shotId === segment.shotId)
      const firstFrameUrl = shot?.firstFrameUrl || ''
      if (!firstFrameUrl) {
        await prisma.videoSegment.update({
          where: { id: segment.id },
          data: { status: 'failed', errorMessage: '没有可用的首帧' },
        })
        continue
      }

      // 逐段标记为生成中，避免服务器超时导致剩余片段全部卡 generating
      await prisma.videoSegment.update({
        where: { id: segment.id },
        data: { status: 'generating', errorMessage: null },
      })

      const kf = keyframes.find((k: any) => k.shotId === segment.shotId)
      const lastFrameUrl = kf?.lastFrameUrl || null
      await backgroundGenerateDirectSegment(
        segment.id,
        projectId,
        segment.prompt,
        firstFrameUrl,
        lastFrameUrl,
        segment.duration || 5,
        body?.videoModel,
        defaultAspectRatio
      )
    }
  })())

  return NextResponse.json({
    success: true,
    count: pendingSegments.length,
    resetCount,
    segmentIds: pendingSegments.map((s) => s.id),
    status: 'generating',
    message: `已启动 ${pendingSegments.length} 个片段的批量生成${resetCount > 0 ? `（已清理 ${resetCount} 个超时片段）` : ''}`,
  })
}

/** 合成视频 */
async function handleComposeDirectVideo(projectId: string, stepId: string) {
  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'VIDEO_DIRECT' },
    orderBy: { sequence: 'asc' },
  })

  const incomplete = segments.filter((s) => s.status !== 'completed')
  if (incomplete.length > 0) {
    return NextResponse.json({
      error: 'INCOMPLETE_SEGMENTS',
      message: `还有 ${incomplete.length} 个片段未生成完成，无法合成`,
      incomplete: incomplete.map((s) => ({ id: s.id, shotId: s.shotId, status: s.status })),
    }, { status: 400 })
  }

  if (segments.length === 0) {
    return NextResponse.json({ error: 'NO_SEGMENTS', message: '没有可合成的片段' }, { status: 400 })
  }

  waitUntil(backgroundComposeDirectVideo(projectId))

  return NextResponse.json({
    success: true,
    status: 'processing',
    message: '视频合成已启动，请稍后查看结果',
  })
}

/** 生成直生视频背景音乐（复用 bgm-generator） */
async function handleGenerateDirectBgm(projectId: string, stepId: string, userId: string) {
  const pointsCheck = await checkPoints(GENERATION_COSTS.BGM)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'VIDEO_DIRECT', status: 'completed' },
    orderBy: { sequence: 'asc' },
  })

  if (segments.length === 0) {
    return NextResponse.json({ error: 'NO_SEGMENTS', message: '先生成至少一个视频片段后再生成背景音乐' }, { status: 400 })
  }

  const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 5), 0)

  try {
    const fwStep = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
    })
    const fw = (fwStep?.outputData as any) || {}
    const storyBrief = fw.synopsis || fw.storyBrief || fw.summary || ''
    const acts = Array.isArray(fw.acts) ? fw.acts : []

    const { generateTrailerBgm } = await import('@/lib/bgm-generator')
    const { bgmPath, bgmExt, bgmMime, bgmIsMock } = await generateTrailerBgm({
      tempDir: '/tmp',
      durationSec: totalDuration,
      storyBrief,
      acts,
    })

    const { uploadFile, getSignedFileUrl } = await import('@/lib/r2')
    const fsPromises = await import('fs').then(m => m.promises)
    const bgmBuf = await fsPromises.readFile(bgmPath)
    const bgmKey = `projects/${projectId}/bgm_${Date.now()}.${bgmExt}`
    let musicUrl: string | null = null
    try {
      await uploadFile(bgmKey, bgmBuf, bgmMime)
      musicUrl = await getSignedFileUrl(bgmKey, 3600 * 24 * 7)
    } catch (err: any) {
      console.warn(`[BGM] 上传失败: ${err?.message}`)
    }

    const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
    const existingOutput = (step?.outputData as any) || {}
    const updatedOutput = {
      ...existingOutput,
      musicUrl,
      musicIsMock: bgmIsMock,
      bgmGeneratedAt: new Date().toISOString(),
    }
    await prisma.workflowStep.update({
      where: { id: stepId },
      data: { outputData: updatedOutput },
    })

    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId, workflowStepId: stepId, success: true })

    return NextResponse.json({
      success: true,
      musicUrl,
      musicIsMock: bgmIsMock,
      message: bgmIsMock ? '生成了静音（API 密钥未配置）' : '背景音乐生成成功',
    })
  } catch (e: any) {
    console.error('[VIDEO-DIRECT-BGM] 失败:', e)
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId, workflowStepId: stepId, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

// ============================================================
// GET
// ============================================================
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'VIDEO_DIRECT' } }
  })

  const assets = await prisma.asset.findMany({
    where: { projectId: params.id, type: 'VIDEO', metadata: { path: ['stepType'], equals: 'VIDEO_DIRECT' } }
  })

  const segments = await prisma.videoSegment.findMany({
    where: { projectId: params.id, stepName: 'VIDEO_DIRECT' },
    orderBy: { sequence: 'asc' },
  })

  const { keyframes } = await getStoryboardAndKeyframes(params.id)
  const hasLastFrames = keyframes.some((k: any) => k.lastFrameUrl)

  const out = (step?.outputData as any) || {}

  return NextResponse.json({
    status: step?.status || 'not_found',
    strategy: hasLastFrames ? 'first-last' : 'first-only',
    clips: assets.map((a) => ({
      shotId: (a.metadata as any)?.shotId,
      url: a.url,
      duration: (a.metadata as any)?.duration,
    })),
    videoSegments: segments,
    segmentPromptsGenerated: out.segmentPromptsGenerated || false,
  })
}
