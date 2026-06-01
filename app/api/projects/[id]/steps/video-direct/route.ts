export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { createQueue, isDemoMode as queueIsDemoMode } from '@/lib/queue'
import { startStep, canExecuteStep } from '@/lib/workflow-executor'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'

// [DASHBOARD-FIX] DEMO 模式下使用 createQueue 返回 Mock，避免 ECONNREFUSED
const videoQueue = createQueue('video-generation')

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
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

  if (step.status === 'COMPLETED' && step.outputData) {
    console.log('[VIDEO_DIRECT] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  // 工作指令.txt（2026-05-26 Phase 6）：接收前端传递的视频模型参数
  let videoModel: string | undefined
  try {
    const body = await req.json()
    videoModel = body?.videoModel
    if (videoModel) {
      console.log(`[VIDEO-DIRECT] 前端选择模型: ${videoModel}`)
    }
  } catch {
    // GET 或没有 body 的请求，忽略
  }

  // Phase 5: 路由层输入检测
  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  const storyboardShots = (storyboardStep?.outputData as any)?.shots || []

  const keyframeStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'KEYFRAMES' } },
    include: { resultAssets: true }
  })

  // Phase 5: 从分镜设计获取首帧
  const firstFrames = storyboardShots.filter((s: any) => s.firstFrameUrl)
  if (firstFrames.length === 0) {
    return NextResponse.json(
      { error: 'WORKFLOW_006', message: '请先完成分镜设计的视频生成模式，生成起始帧' },
      { status: 400 }
    )
  }

  // Phase 5: 从尾帧步骤获取尾帧
  const keyframesData = keyframeStep?.outputData as any || {}
  const keyframes = keyframesData.keyframes || keyframesData.results || []
  const hasLastFrames = keyframes.some((k: any) => k.lastFrameUrl)
  const strategy = hasLastFrames ? 'first-last' : 'first-only'
  console.log(`[VIDEO-DIRECT] 生成策略: ${strategy}`)

  if (!hasLastFrames) {
    console.log('[VIDEO-DIRECT] 未检测到尾帧，使用单首帧生成视频（建议先生成尾帧以获得更连贯动作）')
  } else {
    console.log(`[VIDEO-DIRECT] 检测到尾帧，使用首尾帧生成视频, 数量: ${keyframes.length}`)
  }

  const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  await startStep(step.id)

  const jobs = []
  for (const shot of firstFrames) {
    const shotId = shot.shotId
    const firstFrameUrl = shot.firstFrameUrl

    // Phase 5: 检查该 shot 是否有尾帧（支持部分生成情况）
    const kf = keyframes.find((k: any) => k.shotId === shotId)
    const lastFrameUrl = kf?.lastFrameUrl || null
    const shotStrategy = lastFrameUrl ? 'first-last' : 'first-only'

    const job = await videoQueue.add('generate-direct', {
      stepId: step.id,
      projectId: params.id,
      shotId,
      firstFrameUrl,
      lastFrameUrl,  // Phase 5: 可能为 null
      strategy: shotStrategy,  // Phase 5: 每 shot 独立策略
      type: 'direct',
      videoModel,  // 工作指令.txt（2026-05-26 Phase 6）：透传模型选择
    })
    jobs.push({ shotId, jobId: job.id, strategy: shotStrategy })
  }

  await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
  return NextResponse.json({
    success: true,
    taskId: step.id,
    status: 'queued',
    strategy,
    jobs,
  })
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'VIDEO_DIRECT' } }
  })
  const assets = await prisma.asset.findMany({
    where: { projectId: params.id, type: 'VIDEO', metadata: { path: ['stepType'], equals: 'VIDEO_DIRECT' } }
  })

  // Phase 5: 检测当前策略用于前端显示
  const keyframeStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'KEYFRAMES' } }
  })
  const keyframesData = keyframeStep?.outputData as any || {}
  const keyframes = keyframesData.keyframes || keyframesData.results || []
  const hasLastFrames = keyframes.some((k: any) => k.lastFrameUrl)

  return NextResponse.json({
    status: step?.status || 'not_found',
    strategy: hasLastFrames ? 'first-last' : 'first-only',
    clips: assets.map(a => ({ shotId: (a.metadata as any)?.shotId, url: a.url, duration: (a.metadata as any)?.duration }))
  })
}
