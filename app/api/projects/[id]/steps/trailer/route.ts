import { NextResponse } from 'next/server'
import { auth, isDemoMode, DEMO_USER } from '@/auth'
import { prisma } from '@/lib/prisma'
import { createQueue, isDemoMode as queueIsDemoMode } from '@/lib/queue'
import { startStep, completeStep, failStep, canExecuteStep, tryStartStep } from '@/lib/workflow-executor'

// [DASHBOARD-FIX] DEMO 模式下使用 createQueue 返回 Mock，避免 ECONNREFUSED
const videoQueue = createQueue('video-generation')

// 工作指令.txt（Round 6 任务二）：BullMQ 入队失败时的 setImmediate 兜底处理。
// 直接调用 mockVideoClient.generateTrailer 并写入 Asset + completeStep；
// 与 scripts/video-worker.ts 的 generate-trailer 分支保持一致。
async function processTrailerInline(
  stepId: string,
  projectId: string,
  conceptImageKeys: string[]
) {
  // 工作指令.txt 第二阶段：setImmediate 兜底分支与 Worker 分支保持一致的诊断日志
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
    // 工作指令.txt（Round 7/8）：在 step.outputData 写入完整管线产物
    // —— 前端 TrailerPanel 据此渲染 6 个片段缩略图 + Mock 标记 + Suno 音乐试听
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
    // 工作指令.txt 第5部分：兜底分支 catch 与 Worker catch 保持同样的失败诊断
    // 写入 step.errorMessage 时携带 err.message + err.stack.slice(0,200)，前端 GET 可读取
    const errMessage = e?.message || 'inline trailer generation failed'
    const errDetail = (e?.stack || '').toString().slice(0, 200)
    console.error('[TRAILER-ERROR]', e)
    console.error(`[TRAILER-JOB-FAILED] inline=true, stepId=${stepId}, error=${errMessage}, stack=${errDetail}`)
    try {
      await failStep(stepId, `${errMessage} | detail: ${errDetail}`)
    } catch {}
  }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // 工作指令.txt 第三阶段：路由入队诊断 [TRAILER-POST]
  console.log(`[TRAILER-POST] 收到请求 projectId=${params.id} t=${new Date().toISOString()}`)
  try {
    const session = await auth()
    if (!session?.user?.id) {
      console.warn('[TRAILER-POST] 未登录，401 返回')
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const project = await prisma.project.findUnique({ where: { id: params.id } })

    // Demo 模式：允许操作 demo 用户的项目
    const isOwner = project?.userId === session.user.id
    const isDemoProject = isDemoMode && project?.userId === DEMO_USER.id

    if (!project || (!isOwner && !isDemoProject)) {
      console.warn(`[TRAILER-POST] 鉴权失败 projectExists=${!!project} isOwner=${isOwner} isDemoProject=${isDemoProject}`)
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    if (!await canExecuteStep(params.id, 'TRAILER')) {
      console.warn(`[TRAILER-POST] 前置步骤未完成，拒绝执行`)
      return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
    }

    // 获取概念图资产（按创建时间排序）
    // 工作指令.txt（2026-05-19 Bugfix）：去掉 take: 6，避免 styles/characters 因创建时间早被优先返回
    // Mock Proxy 不支持嵌套关系查询 { step: { stepType: 'CONCEPT' } }，实际查询等价于 { projectId, type: 'IMAGE' }
    const conceptAssets = await prisma.asset.findMany({
      where: { projectId: params.id, type: 'IMAGE' },
      orderBy: { createdAt: 'asc' },
    })
    // 手动过滤确保只取概念图，过滤后再限制 6 张
    const filteredAssets = conceptAssets
      .filter((a) => a.storageKey.includes('/concepts/'))
      .slice(0, 6)
    if (filteredAssets.length !== conceptAssets.length) {
      console.warn(
        `[TRAILER-POST] 过滤掉非概念图 Asset: ${conceptAssets.length} → ${filteredAssets.length}, 被过滤的 keys=` +
        conceptAssets.filter((a) => !a.storageKey.includes('/concepts/')).map((a) => a.storageKey)
      )
    }
    console.log('[TRAILER-POST] conceptAssets storageKeys:', filteredAssets.map((a) => a.storageKey))

    console.log(`[TRAILER-POST] 校验通过，conceptAssets.length=${filteredAssets.length}`)

    if (filteredAssets.length === 0) {
      console.warn('[TRAILER-POST] 未找到概念图，拒绝执行')
      return NextResponse.json({ error: 'WORKFLOW_001', message: '未找到概念图' }, { status: 400 })
    }

    const step = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId: params.id, stepType: 'TRAILER' } }
    })
    if (!step) {
      console.warn('[TRAILER-POST] 找不到 TRAILER 步骤，拒绝执行')
      return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
    }

    const body = await _req.json().catch(() => ({}))
    const force = body?.force === true

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
        where: { projectId: params.id, step: { stepType: 'TRAILER' } }
      })
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: 'PENDING' as any, outputData: {}, errorMessage: null },
      })
    }

    // 2026-05-18:原子化抢锁,防止两个并发 POST 都通过 PROCESSING 检查后双重启动 Veo 任务。
    // tryStartStep 仅当 status ∈ {PENDING, FAILED} 时才能转 PROCESSING,失败说明已被其它请求抢先。
    const claimed = await tryStartStep(step.id)
    if (!claimed) {
      console.log('[TRAILER-POST] 抢锁失败(并发请求已抢先),返回 PROCESSING')
      return NextResponse.json({ success: true, message: '宣传片生成任务已在进行中', status: 'PROCESSING' })
    }

    // 工作指令.txt（Round 6 任务二）：BullMQ 入队 + setImmediate 兜底（修 "Failed to fetch"）
    // 仅当显式开启 TRAILER_USE_QUEUE=1 时才走 BullMQ；否则默认 setImmediate 后台处理，
    // 避免 Redis 不可用时 videoQueue.add() 因 enableOfflineQueue: false 抛错导致 POST 挂起。
    const conceptImageKeys = filteredAssets.map((a) => a.storageKey)
    const useQueue = process.env.TRAILER_USE_QUEUE === '1'
    let queued = false

    console.log(`[TRAILER-POST] 准备分发任务 useQueue=${useQueue} conceptImageKeys.length=${conceptImageKeys.length} stepId=${step.id}`)

    if (useQueue) {
      try {
        const job = await videoQueue.add('generate-trailer', {
          stepId: step.id,
          projectId: params.id,
          conceptImageKeys,
        })
        queued = true
        console.log(`[TRAILER-POST] 入队成功 job.id=${job.id}`)
      } catch (queueErr: any) {
        console.warn('[TRAILER-POST] BullMQ queue failed, fallback to setImmediate:', queueErr.message)
      }
    }

    if (!queued) {
      console.log(`[TRAILER-POST] 走 setImmediate 兜底分支`)
      setImmediate(() => {
        processTrailerInline(step.id, params.id, conceptImageKeys)
      })
    }

    return NextResponse.json({
      success: true,
      taskId: step.id,
      status: queued ? 'queued' : 'PROCESSING',
      message: queued ? '宣传片生成任务已入队' : '宣传片生成任务已在后台启动',
    })
  } catch (err: any) {
    // 工作指令.txt 第5部分：POST 同步阶段意外失败（鉴权/Prisma/入队）也要返回详细错误，
    // 否则前端只会看到通用的 500 "Failed to fetch"，定位非常困难
    console.error('[TRAILER-ERROR]', err)
    return NextResponse.json(
      {
        error: err?.message || 'trailer POST failed',
        detail: (err?.stack || '').toString().slice(0, 200),
      },
      { status: 500 }
    )
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'TRAILER' } }
  })
  if (!step) return NextResponse.json({ status: 'not_found' })

  const asset = await prisma.asset.findFirst({
    where: { stepId: step.id, type: 'VIDEO' }
  })

  // 工作指令.txt（Round 7/8）：把 outputData 里的 segments / musicUrl / musicIsMock 透传给前端
  const out = (step.outputData as any) || {}
  return NextResponse.json({
    status: step.status,
    errorMessage: step.errorMessage,
    videoUrl: asset?.url || out.videoUrl || null,
    duration: out.duration ?? (asset?.metadata as any)?.duration ?? null,
    segments: Array.isArray(out.segments) ? out.segments : [],
    musicUrl: out.musicUrl ?? null,
    musicIsMock: out.musicIsMock ?? true,
  })
}
