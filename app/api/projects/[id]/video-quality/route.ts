export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { WorkflowStepType } from '@prisma/client'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import {
  attachGeneratedClipToTimeline,
} from '@/lib/video-production-state'
import { assessVideoQuality } from '@/lib/video-quality'
import { analyzeRemoteVideoEvidence, extractRemoteVideoFrame } from '@/lib/video-technical-quality'
import {
  evidenceDispositionCanEnterTimeline,
  normalizeVideoEvidenceReview,
  VideoEvidenceValidationError,
} from '@/lib/video-evidence'
import { getSignedFileUrl, uploadFile } from '@/lib/r2'
import { continuityPropagationIssue } from '@/lib/video-continuity-policy'
import { syncContinuityReferenceToNextUnit } from '@/lib/video-continuity-reference'

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
          evidencePackage: true,
        },
      },
    },
  })
  const resolved = await Promise.all(assessments.map(async (assessment) => ({
    ...assessment,
    generatedClip: {
      ...assessment.generatedClip,
      evidencePackage: assessment.generatedClip.evidencePackage
        ? {
            ...assessment.generatedClip.evidencePackage,
            contactSheetUrl: assessment.generatedClip.evidencePackage.contactSheetStorageKey
              ? await getSignedFileUrl(assessment.generatedClip.evidencePackage.contactSheetStorageKey, 3600).catch(() => null)
              : null,
            continuityAnchorUrl: assessment.generatedClip.evidencePackage.continuityAnchorStorageKey
              ? await getSignedFileUrl(assessment.generatedClip.evidencePackage.continuityAnchorStorageKey, 3600).catch(() => null)
              : null,
          }
        : null,
    },
  })))
  return NextResponse.json({ assessments: resolved })
}

/**
 * Persist advisory scores or explicitly adopt a playable clip. Neither action
 * submits paid work; retry remains a separate user-initiated generation action.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const readPermission = await checkProjectPermission(projectId, undefined, { mode: 'READ' })
  if (!readPermission.allowed) return readPermission.response

  const body = await req.json().catch(() => ({}))
  const generatedClipId = typeof body.generatedClipId === 'string' ? body.generatedClipId : ''
  if (!generatedClipId) return NextResponse.json({ error: 'INVALID_CLIP_ID' }, { status: 400 })
  const clip = await prisma.generatedClip.findFirst({
    where: { id: generatedClipId, projectId },
    include: {
      evidencePackage: true,
      generationUnit: { select: { requestedDurationMs: true, strategy: true, tier: true, stepName: true } },
    },
  })
  if (!clip) return NextResponse.json({ error: 'CLIP_NOT_FOUND' }, { status: 404 })
  if (clip.generationUnit.stepName !== 'TRAILER' && clip.generationUnit.stepName !== 'VIDEO_DIRECT') {
    return NextResponse.json({ error: 'UNSUPPORTED_CLIP_STEP' }, { status: 409 })
  }
  const permission = await checkProjectPermission(projectId, undefined, {
    mode: 'EDIT_STEP',
    stepType: clip.generationUnit.stepName as WorkflowStepType,
  })
  if (!permission.allowed) return permission.response

  if (body.action === 'adopt') {
    if (!clip.videoUrl || clip.isMock) return NextResponse.json({ error: 'PLAYABLE_CLIP_NOT_FOUND' }, { status: 404 })
    const evidence = clip.evidencePackage
    if (!evidence || !evidence.reviewedAt || !evidenceDispositionCanEnterTimeline(evidence.disposition)) {
      return NextResponse.json({
        error: 'EVIDENCE_REVIEW_REQUIRED',
        message: evidence?.disposition === 'REJECTED' ? '该素材已判定弃用，不能进入时间线。' : '请先完成素材证据包审片并保存可用范围。',
      }, { status: 409 })
    }
    const adoptedToTimeline = await prisma.$transaction((tx) => attachGeneratedClipToTimeline(tx, {
      generationUnitId: clip.generationUnitId,
      generatedClipId: clip.id,
      durationMs: clip.durationMs,
      sourceStartMs: evidence.usableStartMs ?? 0,
      sourceEndMs: evidence.usableEndMs ?? clip.durationMs,
      evidencePackageId: evidence.id,
      disposition: evidence.disposition,
    }))
    return NextResponse.json({ adoptedToTimeline, providerRequestsSubmitted: false, pointsDeducted: false })
  }

  if (body.action === 'prepare-evidence') {
    if (clip.isMock) return NextResponse.json({ error: 'MOCK_CLIP_HAS_NO_EVIDENCE' }, { status: 409 })
    const sourceUrl = clip.storageKey
      ? await getSignedFileUrl(clip.storageKey, 3600)
      : clip.videoUrl
    if (!sourceUrl) return NextResponse.json({ error: 'VIDEO_SOURCE_NOT_FOUND' }, { status: 404 })
    try {
      const evidence = await analyzeRemoteVideoEvidence(sourceUrl, clip.durationMs)
      if (!evidence.contactSheet) throw new Error(evidence.contactSheetError || '九帧联系表生成失败')
      const storageKey = `projects/${projectId}/video-evidence/${clip.id}-contact-sheet.jpg`
      await uploadFile(storageKey, evidence.contactSheet, 'image/jpeg')
      const evidencePackage = await prisma.videoEvidencePackage.upsert({
        where: { generatedClipId: clip.id },
        create: {
          projectId,
          generatedClipId: clip.id,
          contactSheetStorageKey: storageKey,
          contactSheetFrameTimesMs: evidence.frameTimesMs,
          contactSheetStatus: 'READY',
          technicalEvidence: { ...evidence.technical },
        },
        update: {
          contactSheetStorageKey: storageKey,
          contactSheetFrameTimesMs: evidence.frameTimesMs,
          contactSheetStatus: 'READY',
          contactSheetError: null,
          technicalEvidence: { ...evidence.technical },
        },
      })
      return NextResponse.json({
        evidencePackage: {
          ...evidencePackage,
          contactSheetUrl: await getSignedFileUrl(storageKey, 3600).catch(() => null),
        },
        providerRequestsSubmitted: false,
        pointsDeducted: false,
      })
    } catch (error: any) {
      await prisma.videoEvidencePackage.upsert({
        where: { generatedClipId: clip.id },
        create: {
          projectId,
          generatedClipId: clip.id,
          contactSheetStatus: 'FAILED',
          contactSheetError: String(error?.message || error).slice(0, 1000),
        },
        update: {
          contactSheetStatus: 'FAILED',
          contactSheetError: String(error?.message || error).slice(0, 1000),
        },
      })
      return NextResponse.json({ error: 'EVIDENCE_PREPARATION_FAILED', message: String(error?.message || error) }, { status: 422 })
    }
  }

  if (body.action === 'review-evidence') {
    try {
      const review = normalizeVideoEvidenceReview(body, clip.durationMs)
      const anchorTimeMs = clip.evidencePackage?.continuityAnchorTimeMs
      const invalidatesAnchor = clip.evidencePackage?.continuityReferenceStatus === 'ELIGIBLE'
        && (
          review.disposition === 'REJECTED'
          || anchorTimeMs == null
          || review.usableStartMs == null
          || review.usableEndMs == null
          || anchorTimeMs < review.usableStartMs
          || anchorTimeMs > review.usableEndMs
        )
      const evidencePackage = await prisma.videoEvidencePackage.upsert({
        where: { generatedClipId: clip.id },
        create: {
          projectId,
          generatedClipId: clip.id,
          ...review,
          reviewedById: permission.user.id,
          reviewedAt: new Date(),
        },
        update: {
          ...review,
          reviewedById: permission.user.id,
          reviewedAt: new Date(),
          ...(invalidatesAnchor ? {
            continuityReferenceStatus: 'PENDING',
            continuityAnchorStorageKey: null,
            continuityAnchorTimeMs: null,
            continuityReferenceNote: '可用区间或处置发生变化，需要重新确认连续性锚点。',
            continuityReviewedById: null,
            continuityReviewedAt: null,
          } : {}),
        },
      })
      if (invalidatesAnchor) await syncContinuityReferenceToNextUnit(evidencePackage.id)
      return NextResponse.json({ evidencePackage, providerRequestsSubmitted: false, pointsDeducted: false })
    } catch (error) {
      if (error instanceof VideoEvidenceValidationError) {
        return NextResponse.json({ error: error.code, message: error.message }, { status: 400 })
      }
      throw error
    }
  }

  if (body.action === 'set-continuity-reference') {
    const eligibility = String(body.eligibility || '').trim().toUpperCase()
    if (eligibility !== 'ELIGIBLE' && eligibility !== 'INELIGIBLE') {
      return NextResponse.json({ error: 'INVALID_CONTINUITY_ELIGIBILITY' }, { status: 400 })
    }
    const note = typeof body.continuityReferenceNote === 'string'
      ? body.continuityReferenceNote.trim().slice(0, 2000)
      : ''
    if (eligibility === 'INELIGIBLE') {
      const evidencePackage = await prisma.videoEvidencePackage.upsert({
        where: { generatedClipId: clip.id },
        create: {
          projectId,
          generatedClipId: clip.id,
          continuityReferenceStatus: 'INELIGIBLE',
          continuityReferenceNote: note,
          continuityReviewedById: permission.user.id,
          continuityReviewedAt: new Date(),
        },
        update: {
          continuityReferenceStatus: 'INELIGIBLE',
          continuityAnchorStorageKey: null,
          continuityAnchorTimeMs: null,
          continuityReferenceNote: note,
          continuityReviewedById: permission.user.id,
          continuityReviewedAt: new Date(),
        },
      })
      const propagation = await syncContinuityReferenceToNextUnit(evidencePackage.id)
      return NextResponse.json({ evidencePackage, propagation, providerRequestsSubmitted: false, pointsDeducted: false })
    }

    const anchorTimeMs = Math.round(Number(body.continuityAnchorTimeMs))
    const candidate = {
      ...clip.evidencePackage,
      continuityReferenceStatus: 'ELIGIBLE',
      continuityAnchorStorageKey: 'pending-anchor',
      continuityAnchorTimeMs: anchorTimeMs,
    }
    const issue = continuityPropagationIssue(candidate)
    if (issue) return NextResponse.json({ error: 'CONTINUITY_REFERENCE_INELIGIBLE', message: issue }, { status: 409 })
    const sourceUrl = clip.storageKey
      ? await getSignedFileUrl(clip.storageKey, 3600)
      : clip.videoUrl
    if (!sourceUrl) return NextResponse.json({ error: 'VIDEO_SOURCE_NOT_FOUND' }, { status: 404 })
    const anchor = await extractRemoteVideoFrame(sourceUrl, anchorTimeMs)
    const anchorStorageKey = `projects/${projectId}/video-evidence/${clip.id}-continuity-${anchorTimeMs}.jpg`
    await uploadFile(anchorStorageKey, anchor, 'image/jpeg')
    const evidencePackage = await prisma.videoEvidencePackage.update({
      where: { generatedClipId: clip.id },
      data: {
        continuityReferenceStatus: 'ELIGIBLE',
        continuityAnchorStorageKey: anchorStorageKey,
        continuityAnchorTimeMs: anchorTimeMs,
        continuityReferenceNote: note,
        continuityReviewedById: permission.user.id,
        continuityReviewedAt: new Date(),
      },
    })
    const propagation = await syncContinuityReferenceToNextUnit(evidencePackage.id)
    return NextResponse.json({
      evidencePackage: {
        ...evidencePackage,
        continuityAnchorUrl: await getSignedFileUrl(anchorStorageKey, 3600).catch(() => null),
      },
      propagation,
      providerRequestsSubmitted: false,
      pointsDeducted: false,
    })
  }

  if (body.action !== 'assess') {
    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
  }
  const source = body.source === 'AI' || body.source === 'HUMAN' ? body.source : null
  if (!generatedClipId || !source) {
    return NextResponse.json({ error: 'INVALID_ASSESSMENT_INPUT' }, { status: 400 })
  }
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
