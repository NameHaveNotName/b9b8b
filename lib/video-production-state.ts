import { prisma } from './prisma'
import { randomUUID } from 'crypto'
import {
  estimateVideoCost,
  getVideoModelConfig,
  resolveDurationForModel,
  resolveShotTier,
  resolveVideoModelForShot,
} from './models-config'
import {
  buildGenerationUnitTimeline,
  buildIndependentFallbackPlan,
  packShotsIntoGenerationUnits,
  type CreativeShotPlan,
} from './video-production-plan.ts'
import { assessVideoQuality } from './video-quality.ts'
import { compileMultiShotPrompt } from './video-multishot-prompt.ts'
import {
  buildVideoReferenceManifest,
  compileReferenceAuthorityMap,
  type VideoReferenceInput,
} from './video-reference-manifest.ts'
import { getProductionPlanActivationIssue } from './video-production-activation.ts'
import { analyzeRemoteVideoEvidence } from './video-technical-quality.ts'
import { uploadFile } from './r2.ts'
import { buildAdoptedTimelineRange } from './video-evidence.ts'

function isMissingProductionSchema(error: any): boolean {
  return error?.code === 'P2021' || error?.code === 'P2022'
}

/** Attach a complete clip after an explicit user adoption action. */
export async function attachGeneratedClipToTimeline(
  tx: any,
  args: {
    generationUnitId: string
    generatedClipId: string
    durationMs: number
    sourceStartMs?: number
    sourceEndMs?: number
    evidencePackageId?: string
    disposition?: string
  }
): Promise<boolean> {
  const timeline = await tx.timelineSegment.findFirst({
    where: { generationUnitId: args.generationUnitId },
  })
  if (!timeline) return false
  const adopted = buildAdoptedTimelineRange({
    clipDurationMs: args.durationMs,
    sourceStartMs: args.sourceStartMs,
    sourceEndMs: args.sourceEndMs,
    timelineStartMs: timeline.timelineStartMs,
    previousDurationMs: timeline.durationMs,
  })
  await tx.timelineSegment.update({
    where: { id: timeline.id },
    data: {
      generatedClipId: args.generatedClipId,
      sourceStartMs: adopted.sourceStartMs,
      sourceEndMs: adopted.sourceEndMs,
      durationMs: adopted.durationMs,
      timelineEndMs: adopted.timelineEndMs,
      metadata: {
        ...((timeline.metadata as Record<string, unknown> | null) || {}),
        userAdopted: true,
        userAdoptedAt: new Date().toISOString(),
        evidencePackageId: args.evidencePackageId || null,
        evidenceDisposition: args.disposition || null,
      },
    },
  })
  if (adopted.durationDeltaMs !== 0 && timeline.planId) {
    await tx.timelineSegment.updateMany({
      where: { planId: timeline.planId, sequence: { gt: timeline.sequence } },
      data: {
        timelineStartMs: { increment: adopted.durationDeltaMs },
        timelineEndMs: { increment: adopted.durationDeltaMs },
      },
    })
  }
  return true
}

export interface MultiShotDraftInput extends CreativeShotPlan {
  legacySegmentId?: string | null
  referenceImageUrl?: string | null
  referenceAssets?: VideoReferenceInput[]
}

/** Persist a reviewable multi-shot draft. It never queues or submits generation work. */
export async function createMultiShotProductionPlanDraft(args: {
  projectId: string
  stepName: string
  shots: MultiShotDraftInput[]
  multiShotModelId: string
  maxUnitDurationMs: number
  providerHardShotLimit?: number
  createdById?: string
}): Promise<{ planId: string; unitCount: number; executionReady: false } | false> {
  try {
    const modelConfig = getVideoModelConfig(args.multiShotModelId)
    if (!modelConfig || modelConfig.disabled) throw new Error(`Unsupported multi-shot model: ${args.multiShotModelId}`)
    const packed = packShotsIntoGenerationUnits(args.shots, {
      maxUnitDurationMs: args.maxUnitDurationMs,
      providerHardShotLimit: args.providerHardShotLimit,
    })
    if (!packed.length) throw new Error('Cannot create an empty production plan')
    const plannedTimeline = buildGenerationUnitTimeline(packed)

    return await prisma.$transaction(async (tx) => {
      const plan = await tx.videoProductionPlan.create({
        data: {
          projectId: args.projectId,
          stepName: args.stepName,
          strategy: 'MULTI_SHOT_UNITS',
          status: 'DRAFT',
          modelPolicy: {
            multiShotModelId: args.multiShotModelId,
            maxUnitDurationMs: args.maxUnitDurationMs,
            providerHardShotLimit: args.providerHardShotLimit ?? null,
            executionEnabled: false,
          },
          qualityPolicy: {
            version: 1,
            multiShotRequiresSemanticReview: true,
            mockAccepted: false,
            fallback: 'INDEPENDENT_SHOTS',
          },
          createdById: args.createdById,
        },
      })
      let timelineCursorMs = 0
      let billableDurationMs = 0
      let estimatedCostUsd = 0
      for (let unitIndex = 0; unitIndex < packed.length; unitIndex += 1) {
        const packedUnit = packed[unitIndex]
        const timelineEntry = plannedTimeline[unitIndex]
        const isMulti = packedUnit.shots.length > 1
        const modelId = isMulti
          ? args.multiShotModelId
          : resolveVideoModelForShot(packedUnit.shots[0])
        const unitModelConfig = getVideoModelConfig(modelId)
        if (!unitModelConfig) throw new Error(`Missing video model config: ${modelId}`)
        const referenceInputs = packedUnit.shots.flatMap((rawShot) => {
          const shot = rawShot as MultiShotDraftInput
          if (shot.referenceAssets?.length) {
            return shot.referenceAssets.map((asset) => ({
              ...asset,
              shotIds: [...new Set([...(asset.shotIds || []), shot.shotId])],
            }))
          }
          return shot.referenceImageUrl ? [{
            url: shot.referenceImageUrl,
            role: 'start_state' as const,
            label: `${shot.shotId} start state`,
            shotIds: [shot.shotId],
            authority: 'lock the visible starting composition and subject state',
            exclude: ['unassigned text', 'unrelated background objects'],
          }] : []
        })
        const manifest = buildVideoReferenceManifest(
          referenceInputs,
          unitModelConfig.providerReferenceImageLimit || unitModelConfig.referenceAssetLimit
        )
        const compiled = isMulti
          ? compileMultiShotPrompt({
              shots: packedUnit.shots.map((shot) => ({
                shotId: shot.shotId,
                durationMs: shot.durationMs,
                prompt: shot.prompt || '',
                referenceImageIndices: manifest
                  .filter((item) => item.shotIds.includes(shot.shotId))
                  .map((item) => item.index),
                transitionAfter: 'hard-cut',
              })),
              maxDurationMs: args.maxUnitDurationMs,
              providerHardShotLimit: args.providerHardShotLimit,
              referenceImageCount: manifest.length,
              referenceAuthorityMap: compileReferenceAuthorityMap(manifest),
            })
          : null
        const requestedDurationMs = packedUnit.requestedDurationMs
        const billableSeconds = resolveDurationForModel(modelId, requestedDurationMs / 1000)
        const unitCost = estimateVideoCost(modelId, requestedDurationMs / 1000)
        const unit = await tx.generationUnit.create({
          data: {
            projectId: args.projectId,
            planId: plan.id,
            stepName: args.stepName,
            strategy: isMulti ? 'MULTI_SHOT' : 'SINGLE_SHOT',
            status: 'draft',
            tier: isMulti ? 'hero' : packedUnit.shots[0].tier,
            modelId,
            prompt: compiled?.prompt || packedUnit.shots[0].prompt || '',
            requestedDurationMs,
            billableDurationMs: billableSeconds * 1000,
            estimatedCostUsd: unitCost,
            createdById: args.createdById,
            referenceAssets: {
              mode: isMulti ? 'reference_image' : 'first_frame',
              images: manifest,
              adapterLimit: unitModelConfig.referenceAssetLimit,
              providerLimit: unitModelConfig.providerReferenceImageLimit || unitModelConfig.referenceAssetLimit,
              executionEnabled: false,
            } as any,
          },
        })
        for (let itemIndex = 0; itemIndex < packedUnit.shots.length; itemIndex += 1) {
          const shot = packedUnit.shots[itemIndex] as MultiShotDraftInput
          await tx.generationUnitItem.create({
            data: {
              generationUnitId: unit.id,
              legacySegmentId: shot.legacySegmentId || null,
              shotId: shot.shotId,
              actNumber: shot.actNumber,
              sequence: itemIndex,
              plannedDurationMs: shot.durationMs,
              prompt: shot.prompt || '',
              metadata: {
                tier: shot.tier,
                groupKey: shot.groupKey || null,
                groupingSource: shot.groupingSource || null,
                referenceImageUrl: shot.referenceImageUrl || null,
                referenceImageIndices: manifest
                  .filter((item) => item.shotIds.includes(shot.shotId))
                  .map((item) => item.index),
              },
            },
          })
        }
        // The provider returns one complete video per generation unit. Internal
        // shots stay as prompt structure and are never auto-sliced on the timeline.
        await tx.timelineSegment.create({
          data: {
            projectId: args.projectId,
            planId: plan.id,
            stepName: args.stepName,
            generationUnitId: unit.id,
            sequence: timelineEntry.sequence,
            sourceStartMs: timelineEntry.sourceStartMs,
            sourceEndMs: timelineEntry.sourceEndMs,
            timelineStartMs: timelineEntry.timelineStartMs,
            timelineEndMs: timelineEntry.timelineEndMs,
            durationMs: timelineEntry.durationMs,
            metadata: {
              preserveWholeClip: true,
              internalShotCount: packedUnit.shots.length,
              internalShotIds: timelineEntry.internalShotIds,
              legacySegmentIds: packedUnit.shots
                .map((shot) => (shot as MultiShotDraftInput).legacySegmentId)
                .filter((id): id is string => Boolean(id)),
            },
          },
        })
        timelineCursorMs += requestedDurationMs
        billableDurationMs += billableSeconds * 1000
        estimatedCostUsd += unitCost
      }
      await tx.videoProductionPlan.update({
        where: { id: plan.id },
        data: {
          requestedDurationMs: timelineCursorMs,
          billableDurationMs,
          estimatedCostUsd,
          expectedUsableCostUsd: estimatedCostUsd / (0.75 * 0.7),
        },
      })
      return { planId: plan.id, unitCount: packed.length, executionReady: false as const }
    })
  } catch (error: any) {
    if (isMissingProductionSchema(error)) return false
    throw error
  }
}

export class ProductionPlanActivationError extends Error {
  constructor(
    public readonly code:
      | 'PLAN_NOT_FOUND'
      | 'PLAN_NOT_DRAFT'
      | 'EMPTY_PLAN'
      | 'ACTIVE_PLAN_BUSY'
      | 'UNIT_NOT_READY'
      | 'MODEL_NOT_AVAILABLE'
      | 'REFERENCE_LIMIT_EXCEEDED',
    message: string
  ) {
    super(message)
    this.name = 'ProductionPlanActivationError'
  }
}

/**
 * Freeze a reviewed draft as the current production plan.
 *
 * Activation deliberately stops at `planned`: it never queues a unit, contacts a
 * provider, or deducts points. A separate, explicitly gated execution action must
 * move units from `planned` to `queued` later.
 */
export async function activateMultiShotProductionPlanDraft(args: {
  projectId: string
  stepName: string
  planId: string
  activatedById?: string
}): Promise<{
  planId: string
  status: 'ACTIVE'
  unitCount: number
  unitsQueued: 0
  providerRequestsSubmitted: false
}> {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.videoProductionPlan.findFirst({
      where: {
        id: args.planId,
        projectId: args.projectId,
        stepName: args.stepName,
      },
      include: { units: true },
    })
    if (!plan) {
      throw new ProductionPlanActivationError('PLAN_NOT_FOUND', '没有找到这份生成草案')
    }
    if (plan.status === 'ACTIVE') {
      return {
        planId: plan.id,
        status: 'ACTIVE' as const,
        unitCount: plan.units.length,
        unitsQueued: 0 as const,
        providerRequestsSubmitted: false as const,
      }
    }
    if (plan.status !== 'DRAFT') {
      throw new ProductionPlanActivationError('PLAN_NOT_DRAFT', '这份方案已归档，不能再次确认')
    }
    if (!plan.units.length) {
      throw new ProductionPlanActivationError('EMPTY_PLAN', '空方案不能转为正式计划')
    }

    const busyActiveUnit = await tx.generationUnit.findFirst({
      where: {
        projectId: args.projectId,
        stepName: args.stepName,
        plan: { is: { status: 'ACTIVE' } },
        status: { in: ['queued', 'generating'] },
      },
      select: { id: true },
    })
    if (busyActiveUnit) {
      throw new ProductionPlanActivationError(
        'ACTIVE_PLAN_BUSY',
        '当前正式方案仍有任务在排队或生成，请等待完成后再替换'
      )
    }

    const activationIssue = getProductionPlanActivationIssue(plan.units)
    if (activationIssue) {
      throw new ProductionPlanActivationError(activationIssue.code, activationIssue.message)
    }

    await tx.generationUnit.updateMany({
      where: {
        projectId: args.projectId,
        stepName: args.stepName,
        plan: { is: { status: 'ACTIVE' } },
        status: { in: ['draft', 'planned'] },
      },
      data: { status: 'cancelled' },
    })
    await tx.videoProductionPlan.updateMany({
      where: {
        projectId: args.projectId,
        stepName: args.stepName,
        status: 'ACTIVE',
        id: { not: plan.id },
      },
      data: { status: 'ARCHIVED' },
    })
    await tx.generationUnit.updateMany({
      where: { planId: plan.id },
      data: { status: 'planned' },
    })
    const currentPolicy = plan.modelPolicy && typeof plan.modelPolicy === 'object'
      ? plan.modelPolicy as Record<string, unknown>
      : {}
    await tx.videoProductionPlan.update({
      where: { id: plan.id },
      data: {
        status: 'ACTIVE',
        modelPolicy: {
          ...currentPolicy,
          executionEnabled: false,
          activatedAt: new Date().toISOString(),
          activatedById: args.activatedById || null,
        },
      },
    })
    return {
      planId: plan.id,
      status: 'ACTIVE' as const,
      unitCount: plan.units.length,
      unitsQueued: 0 as const,
      providerRequestsSubmitted: false as const,
    }
  })
}

export async function replaceProductionPlanFromLegacySegments(args: {
  projectId: string
  stepName: string
  segments: any[]
  shots?: any[]
  preferredModel?: string
  createdById?: string
}): Promise<boolean> {
  const { projectId, stepName, segments, shots = [], preferredModel, createdById } = args
  try {
    await prisma.$transaction(async (tx) => {
      await tx.videoProductionPlan.updateMany({
        where: { projectId, stepName, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      })
      // Remove only pre-plan compatibility rows. Versioned historical plans stay auditable.
      await tx.timelineSegment.deleteMany({ where: { projectId, stepName, planId: null } })
      await tx.generationUnit.deleteMany({ where: { projectId, stepName, planId: null } })
      const plan = await tx.videoProductionPlan.create({
        data: {
          projectId,
          stepName,
          strategy: 'INDEPENDENT_SHOTS',
          status: 'ACTIVE',
          modelPolicy: { preferredModel: preferredModel || 'auto' },
          qualityPolicy: { version: 1, heroRequiresSemanticReview: true, mockAccepted: false },
          createdById,
        },
      })

      let timelineCursorMs = 0
      let billableDurationMs = 0
      let estimatedCostUsd = 0
      for (const segment of [...segments].sort((a, b) => a.sequence - b.sequence)) {
        const shot = shots.find((candidate: any) =>
          candidate?.shotId === segment.shotId
          && (segment.actNumber == null || candidate?.actNumber === segment.actNumber)
        ) || shots[segment.sequence] || segment
        const creativeDurationMs = Math.max(1, Number(segment.duration || shot?.duration || 5)) * 1000
        const modelId = resolveVideoModelForShot(shot, preferredModel)
        const firstFrameUrl = shot?.firstFrameUrl || shot?.referenceImageUrl || shot?.imageUrl || null
        const billableDurationSec = resolveDurationForModel(modelId, creativeDurationMs / 1000)
        const unit = await tx.generationUnit.create({
          data: {
            projectId,
            planId: plan.id,
            stepName,
            strategy: 'SINGLE_SHOT',
            status: 'planned',
            tier: resolveShotTier(shot),
            modelId,
            prompt: segment.prompt || '',
            requestedDurationMs: creativeDurationMs,
            billableDurationMs: billableDurationSec * 1000,
            estimatedCostUsd: estimateVideoCost(modelId, creativeDurationMs / 1000),
            referenceAssets: firstFrameUrl ? {
              mode: 'first_frame',
              images: [{
                index: 1,
                url: firstFrameUrl,
                label: `${segment.shotId} 首帧参考`,
                roles: ['identity', 'start_state'],
              }],
            } : undefined,
            createdById,
          },
        })
        await tx.generationUnitItem.create({
          data: {
            generationUnitId: unit.id,
            legacySegmentId: segment.id,
            shotId: segment.shotId,
            actNumber: segment.actNumber,
            sequence: 0,
            plannedDurationMs: creativeDurationMs,
            prompt: segment.prompt || '',
          },
        })
        await tx.timelineSegment.create({
          data: {
            projectId,
            planId: plan.id,
            stepName,
            generationUnitId: unit.id,
            sequence: segment.sequence,
            sourceStartMs: 0,
            sourceEndMs: creativeDurationMs,
            timelineStartMs: timelineCursorMs,
            timelineEndMs: timelineCursorMs + creativeDurationMs,
            durationMs: creativeDurationMs,
            metadata: {
              preserveWholeClip: true,
              internalShotCount: 1,
              internalShotIds: [segment.shotId],
              legacySegmentIds: [segment.id],
            },
          },
        })
        timelineCursorMs += creativeDurationMs
        billableDurationMs += billableDurationSec * 1000
        estimatedCostUsd += estimateVideoCost(modelId, creativeDurationMs / 1000)
      }
      await tx.videoProductionPlan.update({
        where: { id: plan.id },
        data: {
          requestedDurationMs: timelineCursorMs,
          billableDurationMs,
          estimatedCostUsd,
        },
      })
    })
    return true
  } catch (error: any) {
    if (isMissingProductionSchema(error)) {
      console.warn('[VIDEO-PRODUCTION] 2.0 tables are not migrated yet; keeping legacy VideoSegment plan')
      return false
    }
    throw error
  }
}

export async function recordGeneratedClipForLegacySegment(args: {
  projectId: string
  legacySegmentId: string
  modelId?: string
  videoUrl: string
  storageKey: string
  durationMs: number
  isMock: boolean
  providerTaskId?: string
}): Promise<boolean> {
  try {
    const item = await prisma.generationUnitItem.findFirst({
      where: {
        legacySegmentId: args.legacySegmentId,
        OR: [
          { generationUnit: { plan: { is: { status: 'ACTIVE' } } } },
          { generationUnit: { planId: null } },
        ],
      },
      include: { generationUnit: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!item) return false
    const clipId = randomUUID()
    let technicalProbe: Awaited<ReturnType<typeof analyzeRemoteVideoEvidence>>['technical'] | null = null
    let contactSheetStorageKey: string | null = null
    let contactSheetFrameTimesMs: number[] = []
    let contactSheetError: string | null = null
    if (!args.isMock) {
      try {
        const evidence = await analyzeRemoteVideoEvidence(args.videoUrl, args.durationMs)
        technicalProbe = evidence.technical
        contactSheetFrameTimesMs = evidence.frameTimesMs
        contactSheetError = evidence.contactSheetError
        if (evidence.contactSheet) {
          const candidateKey = `projects/${args.projectId}/video-evidence/${clipId}-contact-sheet.jpg`
          await uploadFile(candidateKey, evidence.contactSheet, 'image/jpeg')
          contactSheetStorageKey = candidateKey
        }
      } catch (probeError: any) {
        console.warn('[VIDEO-QUALITY] 技术探测不可用，保留人工审核门控:', probeError?.message || probeError)
        contactSheetStorageKey = null
        contactSheetFrameTimesMs = []
        contactSheetError = String(probeError?.message || probeError).slice(0, 1000)
      }
    }
    const measuredDurationMs = technicalProbe?.measuredDurationMs || args.durationMs
    await prisma.$transaction(async (tx) => {
      const clip = await tx.generatedClip.create({
        data: {
          id: clipId,
          projectId: args.projectId,
          generationUnitId: item.generationUnitId,
          modelId: args.modelId || item.generationUnit.modelId,
          providerTaskId: args.providerTaskId,
          videoUrl: args.videoUrl,
          storageKey: args.storageKey,
          durationMs: measuredDurationMs,
          isMock: args.isMock,
        },
      })
      const quality = assessVideoQuality({
        expectedDurationMs: item.generationUnit.requestedDurationMs,
        actualDurationMs: measuredDurationMs,
        isMock: args.isMock,
        hasVideoStream: technicalProbe?.hasVideoStream,
        blackFrameRatio: technicalProbe?.blackFrameRatio,
        freezeFrameRatio: technicalProbe?.freezeFrameRatio,
        tier: item.generationUnit.tier as any,
        strategy: item.generationUnit.strategy as any,
      })
      await tx.videoQualityAssessment.create({
        data: {
          projectId: args.projectId,
          generatedClipId: clip.id,
          source: 'STATIC',
          decision: quality.decision,
          overallScore: quality.overallScore,
          confidence: quality.confidence,
          scores: quality.scores,
          signals: {
            expectedDurationMs: item.generationUnit.requestedDurationMs,
            actualDurationMs: measuredDurationMs,
            isMock: args.isMock,
            hasVideoStream: technicalProbe?.hasVideoStream ?? null,
            blackFrameRatio: technicalProbe?.blackFrameRatio ?? null,
            freezeFrameRatio: technicalProbe?.freezeFrameRatio ?? null,
            measuredDurationMs: technicalProbe?.measuredDurationMs ?? null,
          },
          reasons: quality.reasons,
        },
      })
      await tx.videoEvidencePackage.create({
        data: {
          projectId: args.projectId,
          generatedClipId: clip.id,
          contactSheetStorageKey,
          contactSheetFrameTimesMs,
          contactSheetStatus: contactSheetStorageKey ? 'READY' : contactSheetError ? 'FAILED' : 'PENDING',
          contactSheetError,
          technicalEvidence: {
            expectedDurationMs: item.generationUnit.requestedDurationMs,
            actualDurationMs: measuredDurationMs,
            isMock: args.isMock,
            hasVideoStream: technicalProbe?.hasVideoStream ?? null,
            blackFrameRatio: technicalProbe?.blackFrameRatio ?? null,
            freezeFrameRatio: technicalProbe?.freezeFrameRatio ?? null,
            measuredDurationMs: technicalProbe?.measuredDurationMs ?? null,
          },
        },
      })
      await tx.generationUnit.update({
        where: { id: item.generationUnitId },
        data: { status: 'completed', modelId: args.modelId || item.generationUnit.modelId },
      })
    })
    return true
  } catch (error: any) {
    if (isMissingProductionSchema(error)) return false
    throw error
  }
}

export async function markGenerationUnitFailedForLegacySegment(
  legacySegmentId: string,
  errorMessage: string
): Promise<boolean> {
  try {
    const item = await prisma.generationUnitItem.findFirst({
      where: {
        legacySegmentId,
        OR: [
          { generationUnit: { plan: { is: { status: 'ACTIVE' } } } },
          { generationUnit: { planId: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!item) return false
    await prisma.generationUnit.update({
      where: { id: item.generationUnitId },
      data: { status: 'failed', errorMessage: errorMessage.slice(0, 500) },
    })
    return true
  } catch (error: any) {
    if (isMissingProductionSchema(error)) return false
    throw error
  }
}

/**
 * Re-plan a failed MULTI_SHOT request as independent requests while preserving
 * the failed unit for audit. This does not submit any provider task.
 */
export async function fallbackMultiShotUnitToIndependent(args: {
  generationUnitId: string
  errorMessage: string
  modelOverride?: string | null
}): Promise<{ createdUnitIds: string[] } | false> {
  try {
    const failedUnit = await prisma.generationUnit.findUnique({
      where: { id: args.generationUnitId },
      include: {
        items: { orderBy: { sequence: 'asc' } },
        timelineSegments: { orderBy: { sequence: 'asc' } },
      },
    })
    if (!failedUnit
      || failedUnit.strategy !== 'MULTI_SHOT'
      || failedUnit.items.length < 2
      || failedUnit.timelineSegments.length !== 1) return false

    const shots: CreativeShotPlan[] = failedUnit.items.map((item) => {
      const metadata = (item.metadata as any) || {}
      const tier = metadata.tier === 'hero' || metadata.tier === 'budget' || metadata.tier === 'standard'
        ? metadata.tier
        : resolveShotTier({ description: item.prompt || '' })
      return {
        shotId: item.shotId,
        actNumber: item.actNumber,
        sequence: item.sequence,
        durationMs: item.plannedDurationMs,
        tier,
        prompt: item.prompt || '',
        groupKey: metadata.groupKey || null,
      }
    })
    const plan = buildIndependentFallbackPlan({
      failedUnitId: failedUnit.id,
      shots,
      modelOverride: args.modelOverride,
    })

    return await prisma.$transaction(async (tx) => {
      await tx.generationUnit.update({
        where: { id: failedUnit.id },
        data: {
          status: 'failed',
          errorMessage: args.errorMessage.slice(0, 500),
        },
      })
      const createdUnitIds: string[] = []
      const fallbackTimelineUnits: Array<{
        unitId: string
        durationMs: number
        shotId: string
        legacySegmentId: string | null
      }> = []
      for (let index = 0; index < plan.length; index += 1) {
        const fallback = plan[index]
        const oldItem = failedUnit.items[index]
        const unit = await tx.generationUnit.create({
          data: {
            projectId: failedUnit.projectId,
            planId: failedUnit.planId,
            stepName: failedUnit.stepName,
            strategy: 'SINGLE_SHOT',
            status: 'planned',
            tier: fallback.shot.tier,
            modelId: fallback.modelId,
            prompt: fallback.shot.prompt || '',
            requestedDurationMs: fallback.requestedDurationMs,
            billableDurationMs: fallback.billableDurationMs,
            estimatedCostUsd: fallback.estimatedCostUsd,
            createdById: failedUnit.createdById,
            referenceAssets: oldItem?.metadata
              ? { inheritedFromItemId: oldItem.id, fallbackFromUnitId: failedUnit.id }
              : { fallbackFromUnitId: failedUnit.id },
          },
        })
        await tx.generationUnitItem.create({
          data: {
            generationUnitId: unit.id,
            legacySegmentId: oldItem.legacySegmentId,
            shotId: oldItem.shotId,
            actNumber: oldItem.actNumber,
            sequence: 0,
            plannedDurationMs: oldItem.plannedDurationMs,
            prompt: oldItem.prompt,
            metadata: {
              ...((oldItem.metadata as any) || {}),
              fallbackFromUnitId: failedUnit.id,
              fallbackFromItemId: oldItem.id,
            },
          },
        })
        fallbackTimelineUnits.push({
          unitId: unit.id,
          durationMs: oldItem.plannedDurationMs,
          shotId: oldItem.shotId,
          legacySegmentId: oldItem.legacySegmentId,
        })
        createdUnitIds.push(unit.id)
      }
      const oldTimeline = failedUnit.timelineSegments[0]
      if (failedUnit.planId) {
        // Move later rows out of the unique sequence range while inserting the
        // independent fallback units, then restore them with the new offset.
        await tx.timelineSegment.updateMany({
          where: { planId: failedUnit.planId, sequence: { gt: oldTimeline.sequence } },
          data: { sequence: { increment: 100_000 } },
        })
      }
      let timelineCursorMs = oldTimeline.timelineStartMs
      for (let index = 0; index < fallbackTimelineUnits.length; index += 1) {
        const fallback = fallbackTimelineUnits[index]
        const data = {
          generationUnitId: fallback.unitId,
          generatedClipId: null,
          sequence: oldTimeline.sequence + index,
          sourceStartMs: 0,
          sourceEndMs: fallback.durationMs,
          timelineStartMs: timelineCursorMs,
          timelineEndMs: timelineCursorMs + fallback.durationMs,
          durationMs: fallback.durationMs,
          metadata: {
            preserveWholeClip: true,
            internalShotCount: 1,
            internalShotIds: [fallback.shotId],
            legacySegmentIds: fallback.legacySegmentId ? [fallback.legacySegmentId] : [],
            fallbackFromUnitId: failedUnit.id,
          },
        }
        if (index === 0) {
          await tx.timelineSegment.update({ where: { id: oldTimeline.id }, data })
        } else {
          await tx.timelineSegment.create({
            data: {
              projectId: failedUnit.projectId,
              planId: failedUnit.planId,
              stepName: failedUnit.stepName,
              ...data,
            },
          })
        }
        timelineCursorMs += fallback.durationMs
      }
      if (failedUnit.planId) {
        await tx.timelineSegment.updateMany({
          where: { planId: failedUnit.planId, sequence: { gte: 100_000 } },
          data: { sequence: { increment: fallbackTimelineUnits.length - 1 - 100_000 } },
        })
      }
      if (failedUnit.planId) {
        await tx.videoProductionPlan.update({
          where: { id: failedUnit.planId },
          data: { strategy: 'MIXED' },
        })
      }
      return { createdUnitIds }
    })
  } catch (error: any) {
    if (isMissingProductionSchema(error)) return false
    throw error
  }
}
