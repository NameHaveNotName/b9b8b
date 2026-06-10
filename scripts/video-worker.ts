import { Worker } from 'bullmq'
import { redisConnection } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { completeStep, failStep, isStepCancelled } from '../lib/workflow-executor'
import { generateOneVideoSegment } from '../lib/video-segment-utils'
import { uploadFile, getSignedFileUrl } from '../lib/r2'

// 动态加载 video client（避免在导入时解析路径别名问题）
async function getVideoClient() {
  const { mockVideoClient } = await import('../lib/api-clients/mock-video')
  return mockVideoClient
}

const worker = new Worker('video-generation', async (job) => {
  const { stepId, projectId, conceptImageKeys, shotId, firstFrameKey, lastFrameKey, type, segmentId } = job.data
  // 工作指令.txt 第二阶段：Worker 入口诊断三件套
  console.log(`[TRAILER-JOB-START] job.id=${job.id}, name=${job.name}, projectId=${projectId}, stepId=${stepId}, timestamp=${new Date().toISOString()}`)
  console.log(`[TRAILER-JOB-DATA] type=${type}, conceptImages count=${(conceptImageKeys || []).length}, shotId=${shotId || ''}, segmentId=${segmentId || ''}`)
  console.log(`[TRAILER-JOB-ENV] XIAOMI_API_KEY exists=${!!process.env.XIAOMI_API_KEY}, REDIS_URL exists=${!!process.env.UPSTASH_REDIS_URL}, R2_ACCOUNT_ID exists=${!!process.env.R2_ACCOUNT_ID && !process.env.R2_ACCOUNT_ID!.startsWith('your-')}`)
  const videoClient = await getVideoClient()

  try {
    if (type === 'trailer' || job.name === 'generate-trailer') {
      console.log(`[TRAILER-SUBMIT-CALL] 准备进入 generateTrailer 管线 projectId=${projectId} keys=${(conceptImageKeys || []).length}`)
      const result = await videoClient.generateTrailer(conceptImageKeys, projectId)
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
          }
        }
      })
      // 工作指令.txt（Round 7/8）：BullMQ 分支与 setImmediate 分支保持一致，
      // 在 step.outputData 写入完整管线产物（segments + musicUrl + musicIsMock）
      if (await isStepCancelled(stepId)) {
        console.log(`[TRAILER-WORKER] step ${stepId} was cancelled by user, aborting`)
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
    }

    if (type === 'direct' || job.name === 'generate-direct') {
      // 工作指令.txt（2026-05-26 Phase 6）：从 job.data 读取 videoModel 并透传给 generateDirectVideo
      const videoModel = job.data?.videoModel
      if (videoModel) {
        console.log(`[VIDEO-DIRECT-WORKER] 使用指定模型: ${videoModel} shotId=${shotId}`)
      }
      const result = await videoClient.generateDirectVideo(firstFrameKey, lastFrameKey, shotId, projectId, videoModel)
      await prisma.asset.create({
        data: {
          projectId,
          stepId,
          type: 'VIDEO',
          mimeType: 'video/mp4',
          storageKey: result.storageKey,
          url: result.url,
          metadata: { shotId, duration: result.duration, model: videoModel || 'mock-direct', stepType: 'VIDEO_DIRECT' }
        }
      })
      // 直生视频一个 Step 对应多个 shot，记录部分完成状态
      const existing = await prisma.workflowStep.findUnique({ where: { id: stepId } })
      const existingOutput = (existing?.outputData as any) || {}
      const completedShots = existingOutput.completedShots || []
      completedShots.push(shotId)
      await prisma.workflowStep.update({
        where: { id: stepId },
        data: { outputData: { ...existingOutput, completedShots, partial: true } }
      })
    }

    // 工作指令.txt（重构）：单片段视频生成（分镜卡片式）
    if (job.name === 'generate-segment' && segmentId) {
      console.log(`[SEGMENT-WORKER] 开始生成 segmentId=${segmentId}`)
      const segment = await prisma.videoSegment.findUnique({ where: { id: segmentId } })
      if (!segment) {
        throw new Error(`VideoSegment not found: ${segmentId}`)
      }

      const { prompt, stepName, duration } = segment
      const imageUrl = job.data?.imageUrl
      const videoModel = job.data?.videoModel

      if (!imageUrl) {
        throw new Error(`Missing imageUrl for segment: ${segmentId}`)
      }

      const result = await generateOneVideoSegment({
        segmentId,
        projectId,
        stepName,
        prompt,
        imageUrl,
        duration: duration || 5,
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

      console.log(`[SEGMENT-WORKER] 完成 segmentId=${segmentId} isMock=${result.isMock}`)
    }

    console.log(`[Worker] Completed job ${job.id}`)
  } catch (e: any) {
    // 工作指令.txt 第二阶段：catch 块统一打 [TRAILER-JOB-FAILED]
    console.error(`[TRAILER-JOB-FAILED] job.id=${job.id}, error=${e?.message}, stack=${(e?.stack || '').slice(0, 500)}`)
    console.error(`[Worker] Failed job ${job.id}:`, e)
    // 如果是 segment 任务，更新 VideoSegment 状态
    if (segmentId) {
      try {
        await prisma.videoSegment.update({
          where: { id: segmentId },
          data: {
            status: 'failed',
            errorMessage: (e?.message || '生成失败').slice(0, 200),
          },
        })
      } catch {}
    }
    await failStep(stepId, e.message)
    throw e
  }
}, { connection: redisConnection, concurrency: 2 })

console.log('Video worker started...')
