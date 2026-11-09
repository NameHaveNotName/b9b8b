export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkProjectPermission } from '@/lib/project-permission'
import { buildKeyframeCoverageReview } from '@/lib/keyframe-coverage'
import { evidenceDispositionCanEnterTimeline } from '@/lib/video-evidence'
import {
  isProductionDeliveryStage,
  nextProductionDeliveryStage,
  normalizeManualDeliveryEvidence,
  evaluateSystemProductionGates,
  type ProductionDeliveryStage,
} from '@/lib/production-delivery'

async function collectEvidence(projectId: string) {
  const [storyboardStep, keyframeStep, plan] = await Promise.all([
    prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: 'STORYBOARD' } },
      select: { outputData: true },
    }),
    prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: 'KEYFRAMES' } },
      select: { outputData: true },
    }),
    prisma.videoProductionPlan.findFirst({
      where: { projectId, stepName: 'VIDEO_DIRECT', status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      include: {
        units: { include: { clips: true } },
        timelineSegments: {
          orderBy: { sequence: 'asc' },
          include: { generatedClip: { include: { evidencePackage: true } } },
        },
      },
    }),
  ])
  const storyboard = (storyboardStep?.outputData as any) || {}
  const keyframes = (keyframeStep?.outputData as any) || {}
  const shots = Array.isArray(storyboard.shots) ? storyboard.shots : []
  const frames = Array.isArray(keyframes.keyframes)
    ? keyframes.keyframes
    : Array.isArray(keyframes.results) ? keyframes.results : []
  const coverage = buildKeyframeCoverageReview({
    shots,
    keyframes: frames,
    overrides: keyframes.coverageReview,
  })
  const units = plan?.units || []
  const timeline = plan?.timelineSegments || []
  const completedUnits = units.filter((unit) => unit.status === 'completed')
  const playableUnits = units.filter((unit) => unit.clips.some((clip) => Boolean(clip.videoUrl) && !clip.isMock))
  const acceptedTimeline = timeline.filter((segment) => {
    const clip = segment.generatedClip
    const evidence = clip?.evidencePackage
    return Boolean(
      clip
      && evidence?.reviewedAt
      && evidenceDispositionCanEnterTimeline(evidence.disposition)
      && evidence.usableStartMs != null
      && evidence.usableEndMs != null
      && segment.sourceStartMs >= evidence.usableStartMs
      && segment.sourceEndMs <= evidence.usableEndMs
      && segment.sourceEndMs <= clip.durationMs
    )
  })
  const snapshot = {
    planId: plan?.id || null,
    planStrategy: plan?.strategy || null,
    storyboardShotCount: shots.length,
    coverageSummary: coverage.summary,
    unitCount: units.length,
    completedUnitCount: completedUnits.length,
    playableUnitCount: playableUnits.length,
    timelineSegmentCount: timeline.length,
    acceptedTimelineSegmentCount: acceptedTimeline.length,
    capturedAt: new Date().toISOString(),
  }
  const systemGates = evaluateSystemProductionGates({
    coverageReady: coverage.summary.readyForVideo,
    hardGapCount: coverage.summary.hardGapCount,
    planExists: Boolean(plan),
    unitCount: units.length,
    completedUnitCount: completedUnits.length,
    playableUnitCount: playableUnits.length,
    timelineSegmentCount: timeline.length,
    acceptedTimelineSegmentCount: acceptedTimeline.length,
  })
  return {
    snapshot,
    gates: {
      ...systemGates,
      POST_PRODUCTION: { ready: true, reasons: ['需要人工提供剪辑工程或审片版本证据'] },
      MASTER_ACCEPTED: { ready: true, reasons: ['需要人工提供母版文件、哈希或审片记录'] },
      PLATFORM_DELIVERED: { ready: true, reasons: ['需要人工提供平台名称与发布/交付记录'] },
    },
  }
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const permission = await checkProjectPermission(projectId, undefined, { mode: 'READ' })
  if (!permission.allowed) return permission.response
  const [state, evidence] = await Promise.all([
    prisma.productionDeliveryState.findUnique({
      where: { projectId },
      include: { milestones: { orderBy: { createdAt: 'asc' } } },
    }),
    collectEvidence(projectId),
  ])
  return NextResponse.json({
    state,
    nextStage: nextProductionDeliveryStage(state?.currentStage as ProductionDeliveryStage | null),
    ...evidence,
  })
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const permission = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: 'VIDEO_DIRECT' })
  if (!permission.allowed) return permission.response
  const body = await req.json().catch(() => ({}))
  const targetStage = body.targetStage
  if (!isProductionDeliveryStage(targetStage)) {
    return NextResponse.json({ error: 'INVALID_DELIVERY_STAGE' }, { status: 400 })
  }
  const collected = await collectEvidence(projectId)
  const gate = collected.gates[targetStage]
  if (!gate.ready && targetStage !== 'POST_PRODUCTION' && targetStage !== 'MASTER_ACCEPTED' && targetStage !== 'PLATFORM_DELIVERED') {
    return NextResponse.json({ error: 'DELIVERY_STAGE_EVIDENCE_INCOMPLETE', message: gate.reasons.join('；'), gate }, { status: 409 })
  }
  let manualEvidence
  try {
    manualEvidence = normalizeManualDeliveryEvidence(targetStage, body)
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_DELIVERY_EVIDENCE', message: error?.message || '交付证据不完整' }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.productionDeliveryState.findUnique({ where: { projectId } })
      const expected = nextProductionDeliveryStage(existing?.currentStage as ProductionDeliveryStage | null)
      if (expected !== targetStage) throw new Error(`STAGE_ORDER:${expected || 'COMPLETE'}`)
      const evidence = {
        system: collected.snapshot,
        manual: manualEvidence,
        gate: { ready: gate.ready, reasons: gate.reasons },
      }
      if (!existing) {
        const state = await tx.productionDeliveryState.create({
          data: {
            projectId,
            currentStage: targetStage,
            updatedById: permission.user.id,
          },
        })
        const milestone = await tx.productionDeliveryMilestone.create({
          data: { stateId: state.id, projectId, stage: targetStage, evidence, note: manualEvidence.note || null, createdById: permission.user.id },
        })
        return { state, milestone }
      }
      const claimed = await tx.productionDeliveryState.updateMany({
        where: { id: existing.id, currentStage: existing.currentStage },
        data: { currentStage: targetStage, updatedById: permission.user.id },
      })
      if (claimed.count !== 1) throw new Error('STAGE_CONFLICT')
      const milestone = await tx.productionDeliveryMilestone.create({
        data: { stateId: existing.id, projectId, stage: targetStage, evidence, note: manualEvidence.note || null, createdById: permission.user.id },
      })
      const state = await tx.productionDeliveryState.findUniqueOrThrow({ where: { id: existing.id } })
      return { state, milestone }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ ...result, nextStage: nextProductionDeliveryStage(targetStage) }, { status: 201 })
  } catch (error: any) {
    if (String(error?.message || '').startsWith('STAGE_ORDER:')) {
      return NextResponse.json({ error: 'DELIVERY_STAGE_OUT_OF_ORDER', message: '制作与交付状态必须按顺序记录，不能跳级或倒退。' }, { status: 409 })
    }
    if (error?.code === 'P2002' || error?.message === 'STAGE_CONFLICT' || error?.code === 'P2034') {
      return NextResponse.json({ error: 'DELIVERY_STAGE_CONFLICT', message: '状态已被其他操作更新，请刷新后重试。' }, { status: 409 })
    }
    throw error
  }
}
