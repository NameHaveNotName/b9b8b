import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!connectionString || !connectionString.startsWith('postgresql://')) {
  throw new Error('DIRECT_URL or DATABASE_URL must be a PostgreSQL connection string')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

try {
  await Promise.all([
    prisma.project.findFirst({ select: { id: true, groupId: true } }),
    prisma.userAsset.findFirst({ select: { id: true, storageKey: true, contentType: true, currentRevisionId: true, deletedAt: true, purgeAfter: true } }),
    prisma.userAssetRevision.findFirst({ select: { id: true, userAssetId: true, ownerId: true, contentType: true, generationSnapshot: true } }),
    prisma.userAssetAttachment.findFirst({ select: { id: true, revisionId: true, role: true, storageKey: true } }),
    prisma.group.findFirst({ select: { id: true, costMode: true } }),
    prisma.groupMembership.findFirst({ select: { id: true, status: true } }),
    prisma.groupPointTransfer.findFirst({ select: { id: true, groupId: true } }),
    prisma.operationLog.findFirst({
      select: {
        id: true,
        billingSource: true,
        billingGroupId: true,
        balanceAfter: true,
        actionKey: true,
        category: true,
        status: true,
        scopeType: true,
        scopeKey: true,
      },
    }),
    prisma.providerCallAttempt.findFirst({ select: { id: true, operationId: true, provider: true } }),
    prisma.asset.findFirst({ select: { id: true, createdById: true, origin: true, contentType: true, sourceUserAssetRevisionId: true, deletedAt: true, purgeAfter: true } }),
    prisma.projectAssetConstraint.findFirst({ select: { id: true, projectId: true, assetId: true, targetStep: true, payloadSnapshot: true } }),
    prisma.assetBinding.findFirst({ select: { id: true, assetId: true, userAssetId: true } }),
    prisma.videoSegment.findFirst({ select: { id: true, createdById: true } }),
    prisma.operationResult.findFirst({
      select: {
        id: true,
        operationId: true,
        storageKey: true,
        targetType: true,
        targetKey: true,
        shotId: true,
        actNumber: true,
        adoptionStatus: true,
      },
    }),
    prisma.storySeries.findFirst({ select: { id: true, userId: true, currentBibleVersion: true, monthlyPointBudget: true, batchGenerationLimit: true, requireBatchApproval: true } }),
    prisma.storySeason.findFirst({ select: { id: true, seriesId: true, seasonNumber: true } }),
    prisma.seriesBibleRevision.findFirst({ select: { id: true, seriesId: true, revisionNumber: true, payload: true } }),
    prisma.storyEpisode.findFirst({ select: { id: true, seriesId: true, seasonId: true, projectId: true, bibleRevisionId: true, episodeNumber: true, continuityBefore: true, continuityAfter: true } }),
    prisma.seriesAsset.findFirst({ select: { id: true, seriesId: true, sourceUserAssetId: true, sourceUserAssetRevisionId: true, contentType: true, storageKey: true, enabled: true } }),
    prisma.seriesMembership.findFirst({ select: { id: true, seriesId: true, userId: true, role: true, assignedEpisodeIds: true, status: true } }),
    prisma.seriesBatchApproval.findFirst({ select: { id: true, seriesId: true, requestedById: true, reviewedById: true, episodeIds: true, requestedPoints: true, status: true } }),
  ])
  console.log('database schema contract verified')
} finally {
  await prisma.$disconnect()
}
