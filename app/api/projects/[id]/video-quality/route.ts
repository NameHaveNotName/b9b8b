export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import {
  attachGeneratedClipToTimeline,
} from '@/lib/video-production-state'
import { assessVideoQuality } from '@/lib/video-quality'

const SEMANTIC_FIELDS = [
  'identityWardrobe',
  'actionTemporal',
  'promptStory',
  'lightingStyle',
  'compositionRhythm',
] as const

function optionalBoundedNumber(
  value: unknown,
  min: number,
  max: number
): number | null | 'INVALID' {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return 'INVALID'
  return parsed
}

/** List persisted quality evidence. This never calls an AI model or provider. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const permission = await checkProjectPermission(projectId, undefined, { mode: 'READ' })
  if (!permission.allowed) return permission.response

  const { searchParams } = new URL(req.url)
  const generatedClipId = searchParams.get('generatedClipId') || undefined
  const stepName = searchParams.get('stepName') || undefined
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit')) || 50))
  const assessments = await prisma.videoQualityAssessment.findMany({
    where: {
      projectId,
      ...(generatedClipId ? { generatedClipId } : {}),
      ...(stepName ? { generatedClip: { generationUnit: { stepName } } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      generatedClip: {
        select: {
          id: true,
          videoUrl: true,
          durationMs: true,
          isMock: true,
          generationUnit: {
            select: { id: true, stepName: true, strategy: true, tier: true, planId: true },
          },
        },
      },
    },
  })
  return NextResponse.json({ assessments })
}

/**
 * Persist advisory scores or explicitly adopt a playable clip. Neither action
 * submits paid work; retry remains a separate user-initiated generation action.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const permission = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: 'VIDEO_DIRECT' })
  if (!permission.allowed) return permission.response

  const body = await req.json().catch(() => ({}))
  if (body.action === 'adopt') {
    const generatedClipId = typeof body.generatedClipId === 'string' ? body.generatedClipId : ''
    const clip = await prisma.generatedClip.findFirst({
      where: { id: generatedClipId, projectId, videoUrl: { not: null }, isMock: false },
      select: { id: true, generationUnitId: true, durationMs: true },
    })
    if (!clip) return NextResponse.json({ error: 'PLAYABLE_CLIP_NOT_FOUND' }, { status: 404 })
    const adoptedToTimeline = await prisma.$transaction((tx) => attachGeneratedClipToTimeline(tx, {
      generationUnitId: clip.generationUnitId,
      generatedClipId: clip.id,
      durationMs: clip.durationMs,
    }))
    return NextResponse.json({ adoptedToTimeline, providerRequestsSubmitted: false, pointsDeducted: false })
  }

  if (body.action !== 'assess') {
    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
  }
  const generatedClipId = typeof body.generatedClipId === 'string' ? body.generatedClipId : ''
  const source = body.source === 'AI' || body.source === 'HUMAN' ? body.source : null
  if (!generatedClipId || !source) {
    return NextResponse.json({ error: 'INVALID_ASSESSMENT_INPUT' }, { status: 400 })
  }
  const clip = await prisma.generatedClip.findFirst({
    where: { id: generatedClipId, projectId },
    include: {
      generationUnit: { select: { requestedDurationMs: true, strategy: true, tier: true } },
    },
  })
  if (!clip) return NextResponse.json({ error: 'CLIP_NOT_FOUND' }, { status: 404 })

  const semantic: Record<(typeof SEMANTIC_FIELDS)[number], number | null> = {
    identityWardrobe: null,
    actionTemporal: null,
    promptStory: null,
    lightingStyle: null,
    compositionRhythm: null,
  }
  for (const field of SEMANTIC_FIELDS) {
    const value = optionalBoundedNumber(body[field], 0, 100)
    if (value === 'INVALID') {
      return NextResponse.json({ error: 'INVALID_SCORE', field, message: '评分必须在 0 到 100 之间' }, { status: 400 })
    }
    semantic[field] = value
  }
  const blackFrameRatio = optionalBoundedNumber(body.blackFrameRatio, 0, 1)
  const freezeFrameRatio = optionalBoundedNumber(body.freezeFrameRatio, 0, 1)
  if (blackFrameRatio === 'INVALID' || freezeFrameRatio === 'INVALID') {
    return NextResponse.json({ error: 'INVALID_FRAME_RATIO', message: '画面比例必须在 0 到 1 之间' }, { status: 400 })
  }
  if (body.hasVideoStream != null && typeof body.hasVideoStream !== 'boolean') {
    return NextResponse.json({ error: 'INVALID_VIDEO_STREAM_SIGNAL' }, { status: 400 })
  }

  const tier: 'hero' | 'standard' | 'budget' | null = clip.generationUnit.tier === 'hero'
    || clip.generationUnit.tier === 'standard'
    || clip.generationUnit.tier === 'budget'
    ? clip.generationUnit.tier
    : null
  const signals = {
    expectedDurationMs: clip.generationUnit.requestedDurationMs,
    actualDurationMs: clip.durationMs,
    isMock: clip.isMock,
    hasVideoStream: body.hasVideoStream as boolean | undefined,
    blackFrameRatio,
    freezeFrameRatio,
    ...semantic,
    tier,
    strategy: clip.generationUnit.strategy === 'MULTI_SHOT' ? 'MULTI_SHOT' as const : 'SINGLE_SHOT' as const,
  }
  const result = assessVideoQuality(signals)
  const assessment = await prisma.videoQualityAssessment.create({
    data: {
      projectId,
      generatedClipId: clip.id,
      source,
      decision: result.decision,
      overallScore: result.overallScore,
      confidence: result.confidence,
      scores: result.scores,
      signals,
      reasons: result.reasons,
      createdById: permission.user.id,
    },
  })
  return NextResponse.json({
    assessment,
    adoptedToTimeline: false,
    providerRequestsSubmitted: false,
    pointsDeducted: false,
  }, { status: 201 })
}
