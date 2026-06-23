export const dynamic = 'force-dynamic'

// Vercel Serverless 强制使用 /tmp 作为临时目录，防止构建缓存导致旧 makeTempDir 回退到 /var/task/.temp
process.env.TEMP_DIR = '/tmp'

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { startStep, completeStep, failStep, canExecuteStep, tryStartStep, isStepCancelled } from '@/lib/workflow-executor'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'

// ============================================================
// 向后兼容：旧版一键生成宣传片
// ============================================================
async function processTrailerInline(
  stepId: string,
  projectId: string,
  conceptImageKeys: string[]
) {
  console.log(`[TRAILER-JOB-START] inline=true, stepId=${stepId}, projectId=${projectId}, timestamp=${new Date().toISOString()}`)
  console.log(`[TRAILER-JOB-DATA] conceptImages count=${conceptImageKeys.length}`)
  console.log(`[TRAILER-JOB-ENV] XIAOMI_API_KEY exists=${!!process.env.XIAOMI_API_KEY}, R2_ACCOUNT_ID configured=${!!process.env.R2_ACCOUNT_ID && !process.env.R2_ACCOUNT_ID.startsWith('your-')}, R2_ENDPOINT configured=${!!process.env.R2_ENDPOINT && !process.env.R2_ENDPOINT.includes('[account-id]')}`)
  try {
    const { mockVideoClient } = await import('@/lib/api-clients/mock-video')
    console.log(`[TRAILER-SUBMIT-CALL] 准备进入 generateTrailer 管线 projectId=${projectId}`)
    const result = await mockVideoClient.generateTrailer(conceptImageKeys, projectId)
    await prisma.asset.create({
      data: {
        projectId,
        stepId,
        type: 'VIDEO',
        mimeType: 'video/mp4',
        storageKey: result.storageKey,
        url: result.url,
        metadata: {
          duration: result.duration,
          model: 'mock-trailer',
          stepType: 'TRAILER',
          segmentCount: result.segments?.length ?? 0,
          mockSegmentCount: result.segments?.filter((s) => s.isMock).length ?? 0,
        },
      },
    })
    if (await isStepCancelled(stepId)) {
      console.log(`[TRAILER-INLINE] step ${stepId} was cancelled by user, aborting`)
      return
    }
    await completeStep(stepId, {
      videoUrl: result.url,
      videoAssetId: result.storageKey,
      duration: result.duration,
      segments: result.segments || [],
      musicUrl: result.musicUrl ?? null,
      musicIsMock: result.musicIsMock ?? true,
    })
    console.log(
      `[TRAILER-INLINE] Completed via setImmediate fallback. segments=${result.segments?.length ?? 0}`
    )
  } catch (e: any) {
    const errMessage = e?.message || 'inline trailer generation failed'
    const errDetail = (e?.stack || '').toString().slice(0, 200)
    console.error('[TRAILER-ERROR]', e)
    console.error(`[TRAILER-JOB-FAILED] inline=true, stepId=${stepId}, error=${errMessage}, stack=${errDetail}`)
    try {
      await failStep(stepId, `${errMessage} | detail: ${errDetail}`)
    } catch {}
  }
}

// ============================================================
// 新版：分镜卡片式逐段生成
// ============================================================

/** 获取 CONCEPT 步骤生成的概念图（宣传片数据源） */
async function getConceptImages(projectId: string) {
  const conceptStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'CONCEPT' } },
  })
  if (!conceptStep) return []
  const conceptAssets = await prisma.asset.findMany({
    where: { projectId, stepId: conceptStep.id, type: 'IMAGE' },
    orderBy: [{ metadata: 'asc' }, { createdAt: 'asc' }],
  })
  return conceptAssets.slice(0, 6)
}

/** 后台生成单个 segment */
async function backgroundGenerateSegment(
  segmentId: string,
  projectId: string,
  stepName: string,
  prompt: string,
  imageUrl: string,
  duration: number,
  videoModel?: string
) {
  try {
    console.log(`[SEGMENT-BG] 开始生成 segmentId=${segmentId}`)
    const { generateOneVideoSegment } = await import('@/lib/video-segment-utils')
    const result = await generateOneVideoSegment({
      segmentId,
      projectId,
      stepName,
      prompt,
      imageUrl,
      duration,
      videoModel,
    })

    // 更新 VideoSegment
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

    // 创建 Asset
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
          stepType: stepName,
        },
      },
    })

    console.log(`[SEGMENT-BG] 完成 segmentId=${segmentId} isMock=${result.isMock}`)
  } catch (e: any) {
    console.error(`[SEGMENT-BG] 失败 segmentId=${segmentId}:`, e?.message)
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
async function backgroundComposeVideo(
  projectId: string,
  stepName: 'TRAILER' | 'VIDEO_DIRECT'
) {
  try {
    console.log(`[COMPOSE-BG] 开始合成 projectId=${projectId}`)
    const segments = await prisma.videoSegment.findMany({
      where: { projectId, stepName, status: 'completed' },
      orderBy: { sequence: 'asc' },
    })

    if (segments.length === 0) {
      throw new Error('没有已完成的片段可合成')
    }

    const { composeVideo } = await import('@/lib/video-segment-utils')
    const result = await composeVideo({
      projectId,
      stepName,
      segments: segments.map((s) => ({
        id: s.id,
        storageKey: s.storageKey,
        videoUrl: s.videoUrl,
        duration: s.duration,
      })),
    })

    console.log(`[COMPOSE-BG] 合成完成 videoUrl=${result.videoUrl}`)
  } catch (e: any) {
    console.error(`[COMPOSE-BG] 合成失败:`, e?.message)
  }
}

// ============================================================
// POST: 主入口（支持 action 分发）
// ============================================================
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  console.log(`[TRAILER-POST] 收到请求 projectId=${params.id} t=${new Date().toISOString()}`)

  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      console.warn('[TRAILER-POST] 未登录，401 返回')
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project) {
      console.warn(`[TRAILER-POST] 项目不存在`)
      return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    }
    const access = await checkProjectAccess(project.userId)
    if (!access.allowed) {
      console.warn(`[TRAILER-POST] 鉴权失败`)
      return access.response
    }

    if (!await canExecuteStep(params.id, 'TRAILER')) {
      console.warn(`[TRAILER-POST] 前置步骤未完成，拒绝执行`)
      return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
    }

    const step = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId: params.id, stepType: 'TRAILER' } }
    })
    if (!step) {
      console.warn('[TRAILER-POST] 找不到 TRAILER 步骤，拒绝执行')
      return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
    }

    const body = await _req.json().catch(() => ({}))
    const action = body?.action || 'legacy'
    const force = body?.force === true

    console.log(`[TRAILER-POST] action=${action} force=${force}`)

    // -------------------- 向后兼容：旧版一键生成 --------------------
    if (action === 'legacy') {
      return handleLegacyTrailer(params.id, step.id, force, userId)
    }

    // -------------------- 新版：生成 Segment Prompts --------------------
    if (action === 'generate-segment-prompts') {
      return handleGeneratePrompts(params.id, step.id, userId)
    }

    // -------------------- 新版：单段生成 --------------------
    if (action === 'generate-segment-video') {
      return handleGenerateSegment(params.id, step.id, body)
    }

    // -------------------- 新版：批量生成 --------------------
    if (action === 'generate-all-segments') {
      return handleGenerateAllSegments(params.id, step.id, body)
    }

    // -------------------- 新版：合成视频 --------------------
    if (action === 'compose-video') {
      return handleComposeVideo(params.id, step.id)
    }

    // -------------------- 新版：生成背景音乐 --------------------
    if (action === 'generate-bgm') {
      return handleGenerateBgm(params.id, step.id)
    }

    return NextResponse.json({ error: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[TRAILER-ERROR]', err)
    return NextResponse.json(
      { error: err?.message || 'trailer POST failed', detail: (err?.stack || '').toString().slice(0, 200) },
      { status: 500 }
    )
  }
}

// ============================================================
// 各 action 处理函数
// ============================================================

/** 旧版一键生成（向后兼容） */
async function handleLegacyTrailer(
  projectId: string,
  stepId: string,
  force: boolean,
  userId: string
) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  if (!force && step.status === 'COMPLETED' && step.outputData) {
    console.log('[TRAILER-POST] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  if (!force && step.status === 'PROCESSING') {
    console.log('[TRAILER-POST] step is PROCESSING, return early')
    return NextResponse.json({ success: true, message: '宣传片生成任务已在进行中', status: 'PROCESSING' })
  }

  if (force) {
    console.log('[TRAILER-POST] force=true, resetting step and clearing old assets')
    await prisma.asset.deleteMany({
      where: { projectId, step: { stepType: 'TRAILER' } }
    })
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PENDING' as any, outputData: {}, errorMessage: null },
    })
  }

  const claimed = await tryStartStep(step.id)
  if (!claimed) {
    console.log('[TRAILER-POST] 抢锁失败(并发请求已抢先),返回 PROCESSING')
    return NextResponse.json({ success: true, message: '宣传片生成任务已在进行中', status: 'PROCESSING' })
  }

  const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  // 读取 CONCEPT 步骤生成的图片（按 actNumber + sceneIndex 排序）
  const conceptStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'CONCEPT' } },
  })
  const conceptAssets = conceptStep
    ? await prisma.asset.findMany({
        where: { projectId, stepId: conceptStep.id, type: 'IMAGE' },
        orderBy: [{ metadata: 'asc' }, { createdAt: 'asc' }],
      })
    : []
  const filteredAssets = conceptAssets.slice(0, 6)

  if (filteredAssets.length === 0) {
    return NextResponse.json({ error: 'WORKFLOW_001', message: '未找到概念图，请先生成概念图' }, { status: 400 })
  }

  const conceptImageKeys = filteredAssets.map((a) => a.storageKey)

  // 尝试使用 BullMQ 队列（可选）
  let queued = false
  if (process.env.TRAILER_USE_QUEUE === '1') {
    try {
      const { createQueue } = await import('@/lib/queue')
      const videoQueue = createQueue('video-generation')
      const job = await videoQueue.add('generate-trailer', {
        stepId: step.id,
        projectId,
        conceptImageKeys,
      })
      queued = true
      console.log(`[TRAILER-POST] 入队成功 job.id=${job.id}`)
    } catch (queueErr: any) {
      console.warn('[TRAILER-POST] BullMQ queue failed, fallback to waitUntil:', queueErr.message)
    }
  }

  if (!queued) {
    console.log(`[TRAILER-POST] 走 waitUntil 兜底分支`)
    waitUntil(processTrailerInline(step.id, projectId, conceptImageKeys))
  }

  await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId, workflowStepId: step.id, success: true })
  return NextResponse.json({
    success: true,
    taskId: step.id,
    status: queued ? 'queued' : 'PROCESSING',
    message: queued ? '宣传片生成任务已入队' : '宣传片生成任务已在后台启动',
  })
}

/** 生成 Segment Prompts（基于 CONCEPT 概念图） */
async function handleGeneratePrompts(projectId: string, stepId: string, callerUserId: string) {
  // 防御性保存：避免某些 minifier/运行时对 catch 块中参数引用的异常行为
  const userId = callerUserId
  try {
    const conceptImages = await getConceptImages(projectId)
    if (conceptImages.length === 0) {
      console.warn('[TRAILER-PROMPTS] 未找到概念图，降级走 legacy 路径')
      return handleLegacyTrailer(projectId, stepId, false, userId)
    }

    const { generateConceptSegmentPrompts } = await import('@/lib/video-segment-utils')
    const segments = await generateConceptSegmentPrompts(projectId, 'TRAILER', conceptImages)

    // 更新 step 状态为 PENDING
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
      message: `已生成 ${segments.length} 个概念图的视频提示词`,
    })
  } catch (e: any) {
    // VideoSegment 表不存在时，降级走 legacy 路径
    if (e.code === 'P2021' || (e.cause && String(e.cause).includes('does not exist'))) {
      console.warn('[TRAILER-PROMPTS] VideoSegment 表不存在，降级走 legacy 路径')
      return handleLegacyTrailer(projectId, stepId, false, userId)
    }
    console.error('[TRAILER-PROMPTS] 失败:', e)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

/** 单段生成 */
async function handleGenerateSegment(projectId: string, stepId: string, body: any) {
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

  // 获取概念图 URL（shotId 复用为 concept asset id）
  const conceptImages = await getConceptImages(projectId)
  const conceptImage = conceptImages.find((img: any) => img.id === segment.shotId)
  const imageUrl = conceptImage?.url || ''
  if (!imageUrl) {
    return NextResponse.json({ error: 'NO_IMAGE', message: '该片段没有可用的概念图' }, { status: 400 })
  }

  // 原子更新：只有状态为 pending/failed 时才设置为 generating，防止并发重复生成
  const updated = await prisma.videoSegment.updateMany({
    where: {
      id: segmentId,
      status: { in: ['pending', 'failed'] },
    },
    data: { status: 'generating', errorMessage: null },
  })

  if (updated.count === 0) {
    return NextResponse.json({ success: true, message: '该片段正在生成中或已完成', status: 'generating' })
  }

  // 后台生成
  waitUntil(backgroundGenerateSegment(
    segmentId,
    projectId,
    'TRAILER',
    segment.prompt,
    imageUrl,
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
async function handleGenerateAllSegments(projectId: string, stepId: string, body: any) {
  const pendingSegments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'TRAILER', status: 'pending' },
    orderBy: { sequence: 'asc' },
  })

  if (pendingSegments.length === 0) {
    return NextResponse.json({ success: true, message: '没有待生成的片段', count: 0 })
  }

  const conceptImages = await getConceptImages(projectId)

  // 批量更新为 generating
  await Promise.all(
    pendingSegments.map((seg) =>
      prisma.videoSegment.update({
        where: { id: seg.id },
        data: { status: 'generating', errorMessage: null },
      })
    )
  )

  // 后台逐个生成
  waitUntil((async () => {
    for (const segment of pendingSegments) {
      const conceptImage = conceptImages.find((img: any) => img.id === segment.shotId)
      const imageUrl = conceptImage?.url || ''
      if (!imageUrl) {
        await prisma.videoSegment.update({
          where: { id: segment.id },
          data: { status: 'failed', errorMessage: '没有可用的概念图' },
        })
        continue
      }
      await backgroundGenerateSegment(
        segment.id,
        projectId,
        'TRAILER',
        segment.prompt,
        imageUrl,
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
async function handleComposeVideo(projectId: string, stepId: string) {
  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'TRAILER' },
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

  // 后台合成
  waitUntil(backgroundComposeVideo(projectId, 'TRAILER'))

  return NextResponse.json({
    success: true,
    status: 'processing',
    message: '视频合成已启动，请稍后查看结果',
  })
}

/** 生成背景音乐 */
async function handleGenerateBgm(projectId: string, stepId: string) {
  // 计算总时长（所有已完成片段之和）
  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'TRAILER', status: 'completed' },
    orderBy: { sequence: 'asc' },
  })

  if (segments.length === 0) {
    return NextResponse.json({ error: 'NO_SEGMENTS', message: '先生成至少一个视频片段后再生成背景音乐' }, { status: 400 })
  }

  const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 5), 0)

  // 读取框架数据
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

  // 上传 BGM 到 R2
  const { uploadFile, getSignedFileUrl } = await import('@/lib/r2')
  const fsPromises = await import('fs').then(m => m.promises)
  const bgmBuf = await fsPromises.readFile(bgmPath)
  const bgmKey = `projects/${projectId}/bgm_${Date.now()}.${bgmExt}`
  let musicUrl: string | null = null
  try {
    await uploadFile(bgmKey, bgmBuf, bgmMime)
    musicUrl = await getSignedFileUrl(bgmKey, 3600 * 24 * 7)
    console.log(`[BGM] 上传完成 key=${bgmKey}`)
  } catch (err: any) {
    console.warn(`[BGM] 上传失败: ${err?.message}`)
  }

  // 保存到 step outputData
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
    message: bgmIsMock ? '生成了静音（API 密钥未配置或服务不可用）' : '背景音乐生成成功',
  })
}

// ============================================================
// GET
// ============================================================
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'TRAILER' } }
  })
  if (!step) return NextResponse.json({ status: 'not_found' })

  const asset = await prisma.asset.findFirst({
    where: { stepId: step.id, type: 'VIDEO' }
  })

  let segments: any[] = []
  try {
    segments = await prisma.videoSegment.findMany({
      where: { projectId: params.id, stepName: 'TRAILER' },
      orderBy: { sequence: 'asc' },
    })
  } catch (e: any) {
    // VideoSegment 表不存在，忽略
    if (e.code !== 'P2021') console.warn('[TRAILER-GET] VideoSegment 查询失败:', e?.message)
  }

  const out = (step.outputData as any) || {}
  return NextResponse.json({
    status: step.status,
    errorMessage: step.errorMessage,
    videoUrl: asset?.url || out.videoUrl || null,
    duration: out.duration ?? (asset?.metadata as any)?.duration ?? null,
    segments: Array.isArray(out.segments) ? out.segments : [],
    musicUrl: out.musicUrl ?? null,
    musicIsMock: out.musicIsMock ?? true,
    videoSegments: segments,
    segmentPromptsGenerated: out.segmentPromptsGenerated || false,
  })
}