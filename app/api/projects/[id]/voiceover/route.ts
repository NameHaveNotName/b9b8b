export const dynamic = 'force-dynamic'
// 批量配音是同步串行执行的（generate-all-audio 会一条条跑 TTS），
// 不声明 maxDuration 会走平台默认值，被提前切断时前端只会看到请求失败、
// 且已生成的段落拿不到结果
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { projectCoreSelect } from '@/lib/db/project-select'
import {
  generateVoiceoverScripts,
  generateVoiceoverAudio,
  generateAllVoiceoverAudio,
  getStoryboardShots,
  getFramework,
  resetStaleGeneratingVoiceovers,
} from '@/lib/voiceover-utils'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS, calculateBatchCost } from '@/lib/points-config'

/**
 * GET /api/projects/:id/voiceover?stepName=VIDEO_DIRECT
 *
 * 返回项目的所有 VoiceoverSegment。
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: projectCoreSelect,
  })
  if (!project) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const permission = await checkProjectPermission(project.id)
  if (!permission.allowed) {
    return permission.response
  }

  const { searchParams } = new URL(req.url)
  const stepName = searchParams.get('stepName') || 'VIDEO_DIRECT'

  let segments: any[] = []
  try {
    segments = await prisma.voiceoverSegment.findMany({
      where: { projectId: params.id, stepName },
      orderBy: { sequence: 'asc' },
    })
  } catch (err: any) {
    if (err.code === 'P2021' || err?.cause?.message?.includes('does not exist')) {
      // voiceover_segments 表尚未创建（迁移未执行），返回空数据
      return NextResponse.json({
        segments: [],
        summary: { total: 0, pending: 0, generating: 0, completed: 0, failed: 0, allCompleted: false },
      })
    }
    throw err
  }

  const allCompleted = segments.length > 0 && segments.every((s) => s.status === 'completed')
  const pendingCount = segments.filter((s) => s.status === 'pending').length
  const generatingCount = segments.filter((s) => s.status === 'generating').length
  const completedCount = segments.filter((s) => s.status === 'completed').length
  const failedCount = segments.filter((s) => s.status === 'failed').length

  return NextResponse.json({
    segments,
    summary: {
      total: segments.length,
      pending: pendingCount,
      generating: generatingCount,
      completed: completedCount,
      failed: failedCount,
      allCompleted,
    },
  })
}

/**
 * POST /api/projects/:id/voiceover
 *
 * Actions:
 * - generate-scripts: 根据框架和分镜生成配音文案
 * - generate-audio: 为单个配音片段生成音频
 * - generate-all-audio: 批量为所有 pending 配音片段生成音频
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: projectCoreSelect,
  })
  if (!project) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const permission = await checkProjectPermission(project.id)
  if (!permission.allowed) {
    return permission.response
  }

  const body = await req.json().catch(() => ({}))
  const action = body?.action || 'generate-scripts'
  const stepName = body?.stepName || 'VIDEO_DIRECT'

  console.log(`[VOICEOVER-POST] action=${action} projectId=${params.id} stepName=${stepName}`)

  if (action === 'generate-scripts') {
    return handleGenerateScripts(params.id, stepName, userId)
  }

  if (action === 'generate-audio') {
    return handleGenerateAudio(params.id, body, userId)
  }

  if (action === 'generate-all-audio') {
    return handleGenerateAllAudio(params.id, stepName, body, userId)
  }

  if (action === 'update-text') {
    return handleUpdateText(params.id, body)
  }

  if (action === 'update-voice') {
    return handleUpdateVoice(params.id, body)
  }

  return NextResponse.json({ error: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }, { status: 400 })
}

async function handleGenerateScripts(projectId: string, stepName: string, userId: string) {
  const pointsCheck = await checkPoints(GENERATION_COSTS.VOICEOVER_SCRIPTS, projectId, 'generation.voiceover_scripts', 'TEXT')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    const framework = await getFramework(projectId)
    const shots = await getStoryboardShots(projectId)

    if (shots.length === 0) {
      return NextResponse.json({ error: 'NO_STORYBOARD', message: '未找到分镜数据' }, { status: 400 })
    }

    const segments = await generateVoiceoverScripts(projectId, stepName, framework, shots)
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId, success: true })

    return NextResponse.json({
      success: true,
      status: 'SCRIPTS_READY',
      segments,
      message: `已生成 ${segments.length} 条配音文案`,
    })
  } catch (e: any) {
    console.error('[VOICEOVER-SCRIPTS] 失败:', e)
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

async function handleGenerateAudio(projectId: string, body: any, userId: string) {
  const segmentId = body?.segmentId
  if (!segmentId) {
    return NextResponse.json({ error: 'MISSING_SEGMENT_ID' }, { status: 400 })
  }

  // 必须按 projectId 限定查询：只校验 URL 上的项目权限、再拿 body 里的 segmentId
  // 去查，会让他人项目的配音片段可被任意成员改写/生成
  const segment = await prisma.voiceoverSegment.findFirst({
    where: { id: segmentId, projectId },
  })
  if (!segment) {
    return NextResponse.json({ error: 'SEGMENT_NOT_FOUND' }, { status: 404 })
  }

  const pointsCheck = await checkPoints(GENERATION_COSTS.VOICEOVER_AUDIO_SEGMENT, segment.projectId, 'generation.voiceover_audio_segment', 'AUDIO')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    await resetStaleGeneratingVoiceovers(segment.projectId)
    const updated = await generateVoiceoverAudio(segmentId, body?.voiceId, userId, projectId)
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: segment.projectId, assetId: segmentId, success: true })
    return NextResponse.json({
      success: true,
      segment: updated,
      message: '配音生成成功',
    })
  } catch (e: any) {
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: segment.projectId, assetId: segmentId, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'AUDIO_001', message: e.message }, { status: 500 })
  }
}

async function handleGenerateAllAudio(projectId: string, stepName: string, body: any, userId: string) {
  await resetStaleGeneratingVoiceovers(projectId)

  const pendingSegments = await prisma.voiceoverSegment.findMany({
    where: { projectId, stepName, status: 'pending' },
    orderBy: { sequence: 'asc' },
  })

  if (pendingSegments.length === 0) {
    return NextResponse.json({ success: true, segmentIds: [], count: 0, message: '没有待生成的配音音频' })
  }

  const batchCost = calculateBatchCost(GENERATION_COSTS.VOICEOVER_AUDIO_SEGMENT, pendingSegments.length)
  const pointsCheck = await checkPoints(batchCost, projectId, 'generation.voiceover_audio_segment', 'AUDIO')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    const { succeeded, failed } = await generateAllVoiceoverAudio(projectId, stepName, body?.voiceId, userId)

    // 只对真正成功的片段计费：预扣整批再"失败就吞掉"会让用户为没生成的音频付费
    const actualCost = succeeded.length * GENERATION_COSTS.VOICEOVER_AUDIO_SEGMENT
    await deductPointsAndLog(userId, actualCost, 'generate', {
      projectId,
      success: true,
      errorMessage: failed.length
        ? `${failed.length}/${pendingSegments.length} 条配音生成失败，未计费: ${failed
            .slice(0, 3)
            .map((f) => f.error)
            .join('; ')}`
        : undefined,
    })

    return NextResponse.json({
      success: true,
      segmentIds: succeeded,
      count: succeeded.length,
      failedCount: failed.length,
      failedSegments: failed,
      message: `已生成 ${succeeded.length} 条配音音频${failed.length ? `，${failed.length} 条失败（未计费）` : ''}`,
    })
  } catch (e: any) {
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'AUDIO_002', message: e.message }, { status: 500 })
  }
}

async function handleUpdateText(projectId: string, body: any) {
  const segmentId = body?.segmentId
  const text = body?.text
  if (!segmentId || typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'MISSING_PARAMS', message: '缺少 segmentId 或 text' }, { status: 400 })
  }

  // 限定在已鉴权的项目内更新，避免越权改写他人配音文案
  const target = await prisma.voiceoverSegment.findFirst({
    where: { id: segmentId, projectId },
    select: { id: true },
  })
  if (!target) {
    return NextResponse.json({ error: 'SEGMENT_NOT_FOUND' }, { status: 404 })
  }

  try {
    const segment = await prisma.voiceoverSegment.update({
      where: { id: target.id },
      data: { text: text.trim() },
    })
    return NextResponse.json({ success: true, segment, message: '文案已更新' })
  } catch (e: any) {
    return NextResponse.json({ error: 'UPDATE_001', message: e.message }, { status: 500 })
  }
}

async function handleUpdateVoice(projectId: string, body: any) {
  const segmentId = body?.segmentId
  const voiceId = body?.voiceId
  if (!segmentId || typeof voiceId !== 'string' || voiceId.trim().length === 0) {
    return NextResponse.json({ error: 'MISSING_PARAMS', message: '缺少 segmentId 或 voiceId' }, { status: 400 })
  }

  const target = await prisma.voiceoverSegment.findFirst({
    where: { id: segmentId, projectId },
    select: { id: true },
  })
  if (!target) {
    return NextResponse.json({ error: 'SEGMENT_NOT_FOUND' }, { status: 404 })
  }

  try {
    const segment = await prisma.voiceoverSegment.update({
      where: { id: target.id },
      data: { voiceId: voiceId.trim() },
    })
    return NextResponse.json({ success: true, segment, message: '音色已更新' })
  } catch (e: any) {
    return NextResponse.json({ error: 'UPDATE_002', message: e.message }, { status: 500 })
  }
}
