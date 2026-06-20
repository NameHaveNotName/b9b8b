export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { createQueue } from '@/lib/queue'
import { startStep, canExecuteStep } from '@/lib/workflow-executor'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'
import { generateSegmentPrompts, generateOneVideoSegment, composeVideo } from '@/lib/video-segment-utils'
import { generateTrailerBgm } from '@/lib/bgm-generator'

const videoQueue = createQueue('video-generation')

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

/** 后台生成单个 segment */
async function backgroundGenerateDirectSegment(
  segmentId: string,
  projectId: string,
  prompt: string,
  firstFrameUrl: string,
  lastFrameUrl: string | null,
  duration: number,
  videoModel?: string
) {
  try {
    console.log(`[DIRECT-SEGMENT-BG] 开始生成 segmentId=${segmentId}`)
    const result = await generateOneVideoSegment({
      segmentId,
      projectId,
      stepName: 'VIDEO_DIRECT',
      prompt,
      imageUrl: firstFrameUrl,
      duration,
      videoModel,
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

    const result = await composeVideo({
      projectId,
      stepName: 'VIDEO_DIRECT',
      segments: segments.map((s) => ({
        id: s.id,
        storageKey: s.storageKey,
        videoUrl: s.videoUrl,
        duration: s.duration,
      })),
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
  const action = body?.action || 'legacy'
  const videoModel = body?.videoModel

  console.log(`[VIDEO-DIRECT-POST] action=${action} projectId=${params.id}`)

  // -------------------- 向后兼容：旧版批量入队 --------------------
  if (action === 'legacy') {
    return handleLegacyDirect(params.id, step.id, body)
  }

  // -------------------- 新版：生成 Segment Prompts --------------------
  if (action === 'generate-segment-prompts') {
    return handleGenerateDirectPrompts(params.id, step.id)
  }

  // -------------------- 新版：单段生成 --------------------
  if (action === 'generate-segment-video') {
    return handleGenerateDirectSegment(params.id, step.id, body)
  }

  // -------------------- 新版：批量生成 --------------------
  if (action === 'generate-all-segments') {
    return handleGenerateAllDirectSegments(params.id, step.id, body)
  }

  // -------------------- 新版：合成视频 --------------------
  if (action === 'compose-video') {
    return handleComposeDirectVideo(params.id, step.id)
  }

  // -------------------- 新版：生成背景音乐 --------------------
  if (action === 'generate-bgm') {
    return handleGenerateDirectBgm(params.id, step.id)
  }

  return NextResponse.json({ error: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }, { status: 400 })
}

// ============================================================
// 各 action 处理函数
// ============================================================

/** 旧版批量入队（向后兼容） */
async function handleLegacyDirect(projectId: string, stepId: string, body: any) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  if (step.status === 'COMPLETED' && step.outputData) {
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  const videoModel = body?.videoModel

  const { shots, keyframes } = await getStoryboardAndKeyframes(projectId)
  if (shots.length === 0) {
    return NextResponse.json(
      { error: 'WORKFLOW_006', message: '请先完成分镜设计' },
      { status: 400 }
    )
  }

  const firstFrames = shots.filter((s: any) => s.firstFrameUrl)
  if (firstFrames.length === 0) {
    return NextResponse.json(
      { error: 'WORKFLOW_006', message: '请先完成分镜设计的视频生成模式，生成起始帧' },
      { status: 400 }
    )
  }

  const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  await startStep(stepId)

  try {
    const jobs = []
    for (const shot of firstFrames) {
      const shotId = shot.shotId
      const firstFrameUrl = shot.firstFrameUrl
      const kf = keyframes.find((k: any) => k.shotId === shotId)
      const lastFrameUrl = kf?.lastFrameUrl || null
      const shotStrategy = lastFrameUrl ? 'first-last' : 'first-only'

      const job = await videoQueue.add('generate-direct', {
        stepId,
        projectId,
        shotId,
        firstFrameUrl,
        lastFrameUrl,
        strategy: shotStrategy,
        type: 'direct',
        videoModel,
      })
      jobs.push({ shotId, jobId: job.id, strategy: shotStrategy })
    }

    await deductPointsAndLog(step.projectId, pointsCheck.cost, 'generate', { projectId, workflowStepId: stepId, success: true })
    return NextResponse.json({
      success: true,
      taskId: stepId,
      status: 'queued',
      jobs,
    })
  } catch (e: any) {
    await deductPointsAndLog(step.projectId, pointsCheck.cost, 'error', { projectId, workflowStepId: stepId, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

/** 生成 Segment Prompts */
async function handleGenerateDirectPrompts(projectId: string, stepId: string) {
  try {
    const { shots } = await getStoryboardAndKeyframes(projectId)
    if (shots.length === 0) {
      return NextResponse.json({ error: 'NO_STORYBOARD', message: '未找到分镜数据' }, { status: 400 })
    }

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

    return NextResponse.json({
      success: true,
      status: 'PROMPT_READY',
      segments,
      message: `已生成 ${segments.length} 个分镜的视频提示词`,
    })
  } catch (e: any) {
    console.error('[VIDEO-DIRECT-PROMPTS] 失败:', e)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

/** 单段生成 */
async function handleGenerateDirectSegment(projectId: string, stepId: string, body: any) {
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

  const { shots, keyframes } = await getStoryboardAndKeyframes(projectId)
  const shot = shots.find((s: any) => s.shotId === segment.shotId)
  const firstFrameUrl = shot?.firstFrameUrl || ''
  if (!firstFrameUrl) {
    return NextResponse.json({ error: 'NO_IMAGE', message: '该分镜没有可用的首帧' }, { status: 400 })
  }

  await prisma.videoSegment.update({
    where: { id: segmentId },
    data: { status: 'generating', errorMessage: null },
  })

  waitUntil(backgroundGenerateDirectSegment(
    segmentId,
    projectId,
    segment.prompt,
    firstFrameUrl,
    null,
    segment.duration || 5,
    body?.videoModel
  ))

  return NextResponse.json({
    success: true,
    segmentId,
    status: 'generating',
    message: '片段生成已启动',
  })
}

/** 批量生成 */
async function handleGenerateAllDirectSegments(projectId: string, stepId: string, body: any) {
  const pendingSegments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'VIDEO_DIRECT', status: 'pending' },
    orderBy: { sequence: 'asc' },
  })

  if (pendingSegments.length === 0) {
    return NextResponse.json({ success: true, message: '没有待生成的片段', count: 0 })
  }

  const { shots } = await getStoryboardAndKeyframes(projectId)

  await Promise.all(
    pendingSegments.map((seg) =>
      prisma.videoSegment.update({
        where: { id: seg.id },
        data: { status: 'generating', errorMessage: null },
      })
    )
  )

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
      await backgroundGenerateDirectSegment(
        segment.id,
        projectId,
        segment.prompt,
        firstFrameUrl,
        null,
        segment.duration || 5,
        body?.videoModel
      )
    }
  })())

  return NextResponse.json({
    success: true,
    count: pendingSegments.length,
    segmentIds: pendingSegments.map((s) => s.id),
    status: 'generating',
    message: `已启动 ${pendingSegments.length} 个片段的批量生成`,
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
async function handleGenerateDirectBgm(projectId: string, stepId: string) {
  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'VIDEO_DIRECT', status: 'completed' },
    orderBy: { sequence: 'asc' },
  })

  if (segments.length === 0) {
    return NextResponse.json({ error: 'NO_SEGMENTS', message: '先生成至少一个视频片段后再生成背景音乐' }, { status: 400 })
  }

  const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 5), 0)

  const fwStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
  })
  const fw = (fwStep?.outputData as any) || {}
  const storyBrief = fw.synopsis || fw.storyBrief || fw.summary || ''
  const acts = Array.isArray(fw.acts) ? fw.acts : []

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

  return NextResponse.json({
    success: true,
    musicUrl,
    musicIsMock: bgmIsMock,
    message: bgmIsMock ? '生成了静音（API 密钥未配置）' : '背景音乐生成成功',
  })
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
    // 新增
    videoSegments: segments,
    segmentPromptsGenerated: out.segmentPromptsGenerated || false,
  })
}
