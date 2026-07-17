export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
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
export async function GET(req: Request, { params }: { params: { id: string } }) {
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

  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
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
export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
  }

  const body = await req.json().catch(() => ({}))
  const action = body?.action || 'generate-scripts'
  const stepName = body?.stepName || 'VIDEO_DIRECT'

  console.log(`[VOICEOVER-POST] action=${action} projectId=${params.id} stepName=${stepName}`)

  if (action === 'generate-scripts') {
    return handleGenerateScripts(params.id, stepName, userId)
  }

  if (action === 'generate-audio') {
    return handleGenerateAudio(body, userId)
  }

  if (action === 'generate-all-audio') {
    return handleGenerateAllAudio(params.id, stepName, body, userId)
  }

  if (action === 'update-text') {
    return handleUpdateText(body)
  }

  if (action === 'update-voice') {
    return handleUpdateVoice(body)
  }

  return NextResponse.json({ error: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }, { status: 400 })
}

async function handleGenerateScripts(projectId: string, stepName: string, userId: string) {
  const pointsCheck = await checkPoints(GENERATION_COSTS.VOICEOVER_SCRIPTS)
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

async function handleGenerateAudio(body: any, userId: string) {
  const segmentId = body?.segmentId
  if (!segmentId) {
    return NextResponse.json({ error: 'MISSING_SEGMENT_ID' }, { status: 400 })
  }

  const segment = await prisma.voiceoverSegment.findUnique({
    where: { id: segmentId },
  })
  if (!segment) {
    return NextResponse.json({ error: 'SEGMENT_NOT_FOUND' }, { status: 404 })
  }

  const pointsCheck = await checkPoints(GENERATION_COSTS.VOICEOVER_AUDIO_SEGMENT)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    await resetStaleGeneratingVoiceovers(segment.projectId)
    const updated = await generateVoiceoverAudio(segmentId, body?.voiceId)
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
  const pointsCheck = await checkPoints(batchCost)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId, success: true })
    const segmentIds = await generateAllVoiceoverAudio(projectId, stepName, body?.voiceId)
    return NextResponse.json({
      success: true,
      segmentIds,
      count: segmentIds.length,
      message: `已生成 ${segmentIds.length} 条配音音频`,
    })
  } catch (e: any) {
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'AUDIO_002', message: e.message }, { status: 500 })
  }
}

async function handleUpdateText(body: any) {
  const segmentId = body?.segmentId
  const text = body?.text
  if (!segmentId || typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'MISSING_PARAMS', message: '缺少 segmentId 或 text' }, { status: 400 })
  }

  try {
    const segment = await prisma.voiceoverSegment.update({
      where: { id: segmentId },
      data: { text: text.trim() },
    })
    return NextResponse.json({ success: true, segment, message: '文案已更新' })
  } catch (e: any) {
    return NextResponse.json({ error: 'UPDATE_001', message: e.message }, { status: 500 })
  }
}

async function handleUpdateVoice(body: any) {
  const segmentId = body?.segmentId
  const voiceId = body?.voiceId
  if (!segmentId || typeof voiceId !== 'string' || voiceId.trim().length === 0) {
    return NextResponse.json({ error: 'MISSING_PARAMS', message: '缺少 segmentId 或 voiceId' }, { status: 400 })
  }

  try {
    const segment = await prisma.voiceoverSegment.update({
      where: { id: segmentId },
      data: { voiceId: voiceId.trim() },
    })
    return NextResponse.json({ success: true, segment, message: '音色已更新' })
  } catch (e: any) {
    return NextResponse.json({ error: 'UPDATE_002', message: e.message }, { status: 500 })
  }
}
