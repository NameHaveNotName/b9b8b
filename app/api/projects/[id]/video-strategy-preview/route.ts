export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getVideoModelConfig, resolveShotTier } from '@/lib/models-config'
import { buildGenerationStrategyPreview, type CreativeShotPlan } from '@/lib/video-production-plan'
import {
  activateMultiShotProductionPlanDraft,
  createMultiShotProductionPlanDraft,
  ProductionPlanActivationError,
} from '@/lib/video-production-state'
import {
  buildShotProductionStructures,
  storyboardShotLookupKey,
  type ShotProductionStructure,
} from '@/lib/video-shot-structure'

const SUPPORTED_STEPS = new Set(['TRAILER', 'VIDEO_DIRECT'])

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value == null || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function structureMapFor(shots: any[]): Map<string, ShotProductionStructure> {
  return new Map(
    buildShotProductionStructures(shots).map((structure) => [structure.lookupKey, structure])
  )
}

/**
 * GET /api/projects/:id/video-strategy-preview?stepName=VIDEO_DIRECT
 *
 * Read-only economics and feasibility preview. This route never creates tasks,
 * deducts points, mutates production plans, or contacts a generation provider.
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const permission = await checkProjectPermission(projectId, undefined, { mode: 'READ' })
  if (!permission.allowed) return permission.response

  const { searchParams } = new URL(req.url)
  const stepName = searchParams.get('stepName') || 'VIDEO_DIRECT'
  if (!SUPPORTED_STEPS.has(stepName)) {
    return NextResponse.json({ error: 'INVALID_STEP', message: '仅支持 TRAILER 或 VIDEO_DIRECT' }, { status: 400 })
  }

  const independentModel = searchParams.get('independentModel') || 'auto'
  if (independentModel !== 'auto' && !getVideoModelConfig(independentModel)) {
    return NextResponse.json({ error: 'INVALID_MODEL', message: '独立生成模型不在已验证配置中' }, { status: 400 })
  }
  const multiShotModel = searchParams.get('multiShotModel') || 'doubao-seedance-2-5-260628'
  const multiCfg = getVideoModelConfig(multiShotModel)
  if (!multiCfg || multiCfg.disabled) {
    return NextResponse.json({ error: 'INVALID_MODEL', message: '长生成单元模型不可用' }, { status: 400 })
  }

  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName },
    orderBy: { sequence: 'asc' },
  })
  if (segments.length === 0) {
    return NextResponse.json({
      error: 'NO_SEGMENTS',
      message: '请先生成视频提示词，再预览生成策略',
    }, { status: 409 })
  }

  const storyboardStep = stepName === 'VIDEO_DIRECT'
    ? await prisma.workflowStep.findUnique({
        where: { projectId_stepType: { projectId, stepType: 'STORYBOARD' } },
        select: { outputData: true },
      })
    : null
  const storyboardShots = Array.isArray((storyboardStep?.outputData as any)?.shots)
    ? (storyboardStep?.outputData as any).shots
    : []
  const storyboardStructures = structureMapFor(storyboardShots)

  const shots: CreativeShotPlan[] = segments.map((segment) => {
    const storyboardShot = storyboardShots.find((shot: any) =>
      shot?.shotId === segment.shotId
      && (segment.actNumber == null || Number(shot?.actNumber) === segment.actNumber)
    ) || {}
    const creativeDurationSec = Number(segment.duration || storyboardShot.duration || 5)
    const durationMs = Math.max(500, Math.round(creativeDurationSec * 1000))
    const structure = storyboardStructures.get(storyboardShotLookupKey({
      shotId: segment.shotId,
      actNumber: segment.actNumber ?? storyboardShot.actNumber,
    }))
    const groupKey = stepName === 'TRAILER'
      ? 'trailer'
      : structure?.groupKey || `isolated:${segment.actNumber ?? 'na'}:${segment.shotId}`
    return {
      shotId: segment.shotId,
      actNumber: segment.actNumber,
      sequence: segment.sequence,
      durationMs,
      tier: resolveShotTier(storyboardShot),
      prompt: segment.prompt,
      groupKey,
      groupingSource: stepName === 'TRAILER' ? 'trailer' : structure?.source || 'isolated',
    }
  })

  const requestedMaxSeconds = boundedInteger(searchParams.get('maxUnitSeconds'), 15, multiCfg.minDuration, multiCfg.maxDuration)
  const maxUnitSeconds = Math.max(multiCfg.minDuration, requestedMaxSeconds)
  const preview = buildGenerationStrategyPreview({
    shots,
    independentModelOverride: independentModel,
    multiShotModelId: multiShotModel,
    maxUnitDurationMs: maxUnitSeconds * 1000,
    // Explicitly gated: format/catalog verification is not sufficient to authorize paid execution.
    multiShotExecutionEnabled: false,
  })

  const [latestDraft, activePlan] = await Promise.all([
    prisma.videoProductionPlan.findFirst({
      where: { projectId, stepName, status: 'DRAFT', strategy: 'MULTI_SHOT_UNITS' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        estimatedCostUsd: true,
        requestedDurationMs: true,
        _count: { select: { units: true } },
      },
    }),
    prisma.videoProductionPlan.findFirst({
      where: { projectId, stepName, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        strategy: true,
        updatedAt: true,
        estimatedCostUsd: true,
        requestedDurationMs: true,
        _count: { select: { units: true } },
      },
    }),
  ])

  return NextResponse.json({
    projectId,
    stepName,
    shotCount: shots.length,
    assumptions: {
      currency: 'USD',
      maxUnitSeconds,
      independentModel,
      multiShotModel,
      groupingEvidence: shots.reduce<Record<string, number>>((counts, shot) => {
        const source = shot.groupingSource || 'isolated'
        counts[source] = (counts[source] || 0) + 1
        return counts
      }, {}),
      providerRequestsSubmitted: false,
      pointsDeducted: false,
    },
    preview,
    planState: {
      latestDraft: latestDraft ? {
        id: latestDraft.id,
        createdAt: latestDraft.createdAt,
        estimatedCostUsd: latestDraft.estimatedCostUsd,
        requestedDurationMs: latestDraft.requestedDurationMs,
        unitCount: latestDraft._count.units,
      } : null,
      activePlan: activePlan ? {
        id: activePlan.id,
        strategy: activePlan.strategy,
        activatedAt: activePlan.updatedAt,
        estimatedCostUsd: activePlan.estimatedCostUsd,
        requestedDurationMs: activePlan.requestedDurationMs,
        unitCount: activePlan._count.units,
      } : null,
    },
  })
}

/** Persist a non-executable multi-shot draft for review and later activation. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const body = await req.json().catch(() => ({}))
  if (!['save-multi-shot-draft', 'activate-multi-shot-draft'].includes(body.action)) {
    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
  }
  const stepName = typeof body.stepName === 'string' ? body.stepName : 'VIDEO_DIRECT'
  if (!SUPPORTED_STEPS.has(stepName)) {
    return NextResponse.json({ error: 'INVALID_STEP', message: '仅支持 TRAILER 或 VIDEO_DIRECT' }, { status: 400 })
  }
  const permission = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: stepName as 'TRAILER' | 'VIDEO_DIRECT' })
  if (!permission.allowed) return permission.response
  if (body.action === 'activate-multi-shot-draft') {
    if (typeof body.planId !== 'string' || !body.planId) {
      return NextResponse.json({ error: 'PLAN_ID_REQUIRED', message: '缺少待确认的草案编号' }, { status: 400 })
    }
    try {
      const result = await activateMultiShotProductionPlanDraft({
        projectId,
        stepName,
        planId: body.planId,
        activatedById: permission.user.id,
      })
      return NextResponse.json({
        ...result,
        message: '方案已冻结为当前正式计划；尚未排队，不会提交供应商任务或扣点。',
      })
    } catch (error) {
      if (error instanceof ProductionPlanActivationError) {
        return NextResponse.json({ error: error.code, message: error.message }, { status: 409 })
      }
      throw error
    }
  }
  const multiShotModel = typeof body.multiShotModel === 'string'
    ? body.multiShotModel
    : 'doubao-seedance-2-5-260628'
  const multiCfg = getVideoModelConfig(multiShotModel)
  if (!multiCfg || multiCfg.disabled) {
    return NextResponse.json({ error: 'INVALID_MODEL', message: '长生成单元模型不可用' }, { status: 400 })
  }
  const maxUnitSeconds = Math.max(
    multiCfg.minDuration,
    boundedInteger(String(body.maxUnitSeconds ?? ''), 15, multiCfg.minDuration, multiCfg.maxDuration)
  )
  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName },
    orderBy: { sequence: 'asc' },
  })
  if (segments.length < 2) {
    return NextResponse.json({
      error: 'NOT_ENOUGH_SEGMENTS',
      message: '至少需要两个视频镜头才能保存长生成草案',
    }, { status: 409 })
  }

  const storyboardStep = stepName === 'VIDEO_DIRECT'
    ? await prisma.workflowStep.findUnique({
        where: { projectId_stepType: { projectId, stepType: 'STORYBOARD' } },
        select: { outputData: true },
      })
    : null
  const storyboardShots = Array.isArray((storyboardStep?.outputData as any)?.shots)
    ? (storyboardStep?.outputData as any).shots
    : []
  const storyboardStructures = structureMapFor(storyboardShots)
  const trailerAssets = stepName === 'TRAILER'
    ? await prisma.asset.findMany({
        where: { projectId, id: { in: segments.map((segment) => segment.shotId) } },
        select: { id: true, url: true },
      })
    : []
  const trailerAssetMap = new Map(trailerAssets.map((asset) => [asset.id, asset.url]))
  const shots = segments.map((segment) => {
    const storyboardShot = storyboardShots.find((shot: any) =>
      shot?.shotId === segment.shotId
      && (segment.actNumber == null || Number(shot?.actNumber) === segment.actNumber)
    ) || {}
    const durationMs = Math.max(
      500,
      Math.round(Number(segment.duration || storyboardShot.duration || 5) * 1000)
    )
    const structure = storyboardStructures.get(storyboardShotLookupKey({
      shotId: segment.shotId,
      actNumber: segment.actNumber ?? storyboardShot.actNumber,
    }))
    return {
      legacySegmentId: segment.id,
      shotId: segment.shotId,
      actNumber: segment.actNumber,
      sequence: segment.sequence,
      durationMs,
      tier: resolveShotTier(storyboardShot),
      prompt: segment.prompt,
      groupKey: stepName === 'TRAILER'
        ? 'trailer'
        : structure?.groupKey || `isolated:${segment.actNumber ?? 'na'}:${segment.shotId}`,
      groupingSource: stepName === 'TRAILER' ? 'trailer' as const : structure?.source || 'isolated' as const,
      referenceImageUrl: stepName === 'TRAILER'
        ? trailerAssetMap.get(segment.shotId) || null
        : storyboardShot.firstFrameUrl
          || storyboardShot.referenceImageUrl
          || storyboardShot.imageUrl
          || null,
    }
  })
  const result = await createMultiShotProductionPlanDraft({
    projectId,
    stepName,
    shots,
    multiShotModelId: multiShotModel,
    maxUnitDurationMs: maxUnitSeconds * 1000,
    createdById: permission.user.id,
  })
  if (!result) {
    return NextResponse.json({
      error: 'SCHEMA_NOT_READY',
      message: '2.0 数据库迁移尚未部署，无法保存草案',
    }, { status: 503 })
  }
  return NextResponse.json({
    ...result,
    message: '多镜头草案已保存；执行开关保持关闭，不会提交供应商任务或扣点。',
  }, { status: 201 })
}
