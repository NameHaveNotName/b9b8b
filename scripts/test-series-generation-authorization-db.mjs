import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL is required')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, max: 6 }),
})

const suffix = crypto.randomUUID().replaceAll('-', '')
const ownerId = `db_contract_owner_${suffix}`
const collaboratorId = `db_contract_collab_${suffix}`
const projectId = `db_contract_project_${suffix}`
const seriesId = `db_contract_series_${suffix}`
const seasonId = `db_contract_season_${suffix}`
const bibleId = `db_contract_bible_${suffix}`
const episodeId = `db_contract_episode_${suffix}`
const approvalId = `db_contract_approval_${suffix}`

async function reserve(operationId) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.seriesBatchApproval.findUniqueOrThrow({
      where: { id: approvalId },
    })
    if (candidate.status !== 'APPROVED' || candidate.consumedPoints + 70 > candidate.requestedPoints) {
      throw new Error('APPROVAL_EXHAUSTED')
    }

    const claimed = await tx.seriesBatchApproval.updateMany({
      where: {
        id: approvalId,
        status: 'APPROVED',
        consumedPoints: candidate.consumedPoints,
      },
      data: { consumedPoints: { increment: 70 } },
    })
    if (claimed.count !== 1) throw new Error('APPROVAL_CONFLICT')

    await tx.seriesGenerationAuthorization.create({
      data: {
        seriesId,
        approvalId,
        operationId,
        projectId,
        episodeId,
        userId: collaboratorId,
        points: 70,
      },
    })
  }, { isolationLevel: 'Serializable' })
}

try {
  await prisma.user.createMany({
    data: [
      { id: ownerId, email: `${ownerId}@invalid.example` },
      { id: collaboratorId, email: `${collaboratorId}@invalid.example` },
    ],
  })
  await prisma.project.create({
    data: { id: projectId, userId: ownerId, title: 'DB contract fixture', rawIdea: 'temporary' },
  })
  await prisma.storySeries.create({
    data: { id: seriesId, userId: ownerId, title: 'DB contract fixture', monthlyPointBudget: 100 },
  })
  await prisma.storySeason.create({
    data: { id: seasonId, seriesId, seasonNumber: 1 },
  })
  await prisma.seriesBibleRevision.create({
    data: { id: bibleId, seriesId, revisionNumber: 1, payload: {}, createdById: ownerId },
  })
  await prisma.storyEpisode.create({
    data: {
      id: episodeId,
      seriesId,
      seasonId,
      projectId,
      bibleRevisionId: bibleId,
      episodeNumber: 1,
      title: 'DB contract fixture',
    },
  })
  await prisma.seriesBatchApproval.create({
    data: {
      id: approvalId,
      seriesId,
      requestedById: collaboratorId,
      reviewedById: ownerId,
      episodeIds: [episodeId],
      requestedPoints: 100,
      purpose: 'temporary concurrency contract',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() + 60_000),
    },
  })

  const outcomes = await Promise.allSettled([
    reserve(`db_contract_op_a_${suffix}`),
    reserve(`db_contract_op_b_${suffix}`),
  ])
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal(outcomes.filter(({ status }) => status === 'rejected').length, 1)

  const [approval, authorizationCount] = await Promise.all([
    prisma.seriesBatchApproval.findUniqueOrThrow({ where: { id: approvalId } }),
    prisma.seriesGenerationAuthorization.count({ where: { approvalId } }),
  ])
  assert.equal(approval.consumedPoints, 70)
  assert.equal(authorizationCount, 1)
  console.log('series generation authorization database concurrency contract passed')
} finally {
  await prisma.storySeries.deleteMany({ where: { id: seriesId } }).catch(() => undefined)
  await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined)
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, collaboratorId] } } }).catch(() => undefined)
  await prisma.$disconnect()
}
