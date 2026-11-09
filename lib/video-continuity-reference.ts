import { prisma } from './prisma'
import { getSignedFileUrl, toStorageReference } from './r2.ts'
import {
  continuityReferenceCanPropagate,
  mergeContinuityReferenceAsset,
  removeContinuityReferenceAsset,
} from './video-continuity-policy.ts'

export async function resolveEligibleContinuityAnchorForLegacySegment(args: {
  projectId: string
  segmentId: string
}): Promise<{ url: string; evidencePackageId: string; anchorTimeMs: number } | null> {
  const current = await prisma.videoSegment.findFirst({
    where: { id: args.segmentId, projectId: args.projectId, stepName: 'VIDEO_DIRECT' },
    select: { sequence: true },
  })
  if (!current) return null
  const previous = await prisma.videoSegment.findFirst({
    where: {
      projectId: args.projectId,
      stepName: 'VIDEO_DIRECT',
      sequence: { lt: current.sequence },
    },
    orderBy: { sequence: 'desc' },
    select: { id: true },
  })
  if (!previous) return null
  const clip = await prisma.generatedClip.findFirst({
    where: {
      projectId: args.projectId,
      generationUnit: { items: { some: { legacySegmentId: previous.id } } },
    },
    orderBy: { createdAt: 'desc' },
    include: { evidencePackage: true },
  })
  const evidence = clip?.evidencePackage
  if (!evidence || !continuityReferenceCanPropagate(evidence)) return null
  try {
    return {
      url: await getSignedFileUrl(evidence.continuityAnchorStorageKey!, 3600),
      evidencePackageId: evidence.id,
      anchorTimeMs: evidence.continuityAnchorTimeMs!,
    }
  } catch (error: any) {
    console.warn('[VIDEO-CONTINUITY] 已批准锚点暂不可访问，回退当前镜头首帧:', error?.message || error)
    return null
  }
}

/** Synchronize an approved anchor into the next editable generation unit's reference manifest. */
export async function syncContinuityReferenceToNextUnit(evidencePackageId: string) {
  const evidence = await prisma.videoEvidencePackage.findUnique({
    where: { id: evidencePackageId },
    include: {
      generatedClip: {
        include: {
          generationUnit: { include: { timelineSegments: { orderBy: { sequence: 'asc' } } } },
        },
      },
    },
  })
  if (!evidence) return { updated: false, reason: 'EVIDENCE_NOT_FOUND' }
  const sourceTimeline = evidence.generatedClip.generationUnit.timelineSegments.find((item) => item.planId)
  if (!sourceTimeline?.planId) return { updated: false, reason: 'NEXT_UNIT_NOT_FOUND' }
  const nextTimeline = await prisma.timelineSegment.findFirst({
    where: { planId: sourceTimeline.planId, sequence: { gt: sourceTimeline.sequence } },
    orderBy: { sequence: 'asc' },
    include: { generationUnit: true },
  })
  if (!nextTimeline) return { updated: false, reason: 'NEXT_UNIT_NOT_FOUND' }
  if (nextTimeline.generationUnit.status === 'generating' || nextTimeline.generationUnit.status === 'completed') {
    return { updated: false, reason: 'TARGET_UNIT_LOCKED' }
  }

  const nextReferenceAssets = continuityReferenceCanPropagate(evidence)
    ? mergeContinuityReferenceAsset(nextTimeline.generationUnit.referenceAssets, {
        url: toStorageReference(evidence.continuityAnchorStorageKey!),
        storageKey: evidence.continuityAnchorStorageKey!,
        label: '上一单元人工确认连续性锚点',
        roles: ['continuity'],
        authority: '仅用于继承上一单元已验收时刻的人物、姿态、道具与空间连续状态',
        exclude: ['错误尾帧', '未验收区间', '文字与界面内容', '与当前镜头无关的背景细节'],
        sourceEvidencePackageId: evidence.id,
        anchorTimeMs: evidence.continuityAnchorTimeMs!,
        propagationEligibility: 'ELIGIBLE',
      })
    : removeContinuityReferenceAsset(nextTimeline.generationUnit.referenceAssets, evidence.id)
  await prisma.generationUnit.update({
    where: { id: nextTimeline.generationUnitId },
    data: { referenceAssets: nextReferenceAssets },
  })
  return {
    updated: true,
    targetGenerationUnitId: nextTimeline.generationUnitId,
    propagated: continuityReferenceCanPropagate(evidence),
  }
}
