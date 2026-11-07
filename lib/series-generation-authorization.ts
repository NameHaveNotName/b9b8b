import { prisma } from '@/lib/prisma'
import { getSeriesBudgetState } from '@/lib/series-budget'
import type { Prisma } from '@prisma/client'
import { canReserveSeriesBudget, selectApplicableSeriesApproval } from './series-generation-policy.ts'

export class SeriesGenerationAuthorizationError extends Error {
  constructor(public code: string) {
    super(code)
    this.name = 'SeriesGenerationAuthorizationError'
  }
}

export async function getProjectSeriesGenerationContext(projectId: string) {
  return prisma.storyEpisode.findUnique({
    where: { projectId },
    select: { id: true, seriesId: true },
  })
}

export async function reserveSeriesGenerationAuthorization(input: {
  operationId: string
  projectId: string
  userId: string
  points: number
}) {
  if (input.points <= 0) return { required: false as const }
  return prisma.$transaction(async (tx) => {
    const episode = await tx.storyEpisode.findUnique({
      where: { projectId: input.projectId },
      select: {
        id: true,
        seriesId: true,
        series: { select: { userId: true, monthlyPointBudget: true, requireBatchApproval: true } },
      },
    })
    if (!episode) return { required: false as const }

    const existing = await tx.seriesGenerationAuthorization.findUnique({ where: { operationId: input.operationId } })
    if (existing) return { required: true as const, authorizationId: existing.id, approvalId: existing.approvalId }

    let approvalId: string | null = null
    if (episode.series.userId !== input.userId && episode.series.requireBatchApproval) {
      const candidates = await tx.seriesBatchApproval.findMany({
        where: {
          seriesId: episode.seriesId,
          requestedById: input.userId,
          status: 'APPROVED',
          expiresAt: { gt: new Date() },
        },
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      })
      const candidate = selectApplicableSeriesApproval(candidates, {
        userId: input.userId,
        episodeId: episode.id,
        points: input.points,
      })
      if (!candidate) throw new SeriesGenerationAuthorizationError('SERIES_APPROVAL_REQUIRED')

      const nextConsumed = candidate.consumedPoints + input.points
      const claimed = await tx.seriesBatchApproval.updateMany({
        where: {
          id: candidate.id,
          status: 'APPROVED',
          expiresAt: { gt: new Date() },
          consumedPoints: candidate.consumedPoints,
        },
        data: {
          consumedPoints: { increment: input.points },
          status: nextConsumed >= candidate.requestedPoints ? 'CONSUMED' : 'APPROVED',
        },
      })
      if (claimed.count !== 1) throw new SeriesGenerationAuthorizationError('SERIES_APPROVAL_CONFLICT')
      approvalId = candidate.id
    }

    const budget = await getSeriesBudgetState(episode.seriesId, episode.series.monthlyPointBudget, undefined, tx)
    if (!canReserveSeriesBudget(budget.remainingPoints, input.points)) {
      throw new SeriesGenerationAuthorizationError('SERIES_MONTHLY_BUDGET_EXCEEDED')
    }

    const authorization = await tx.seriesGenerationAuthorization.create({
      data: {
        seriesId: episode.seriesId,
        approvalId,
        operationId: input.operationId,
        projectId: input.projectId,
        episodeId: episode.id,
        userId: input.userId,
        points: input.points,
      },
    })
    return { required: true as const, authorizationId: authorization.id, approvalId }
  }, { isolationLevel: 'Serializable' })
}

export async function finalizeSeriesGenerationAuthorization(
  tx: Prisma.TransactionClient,
  operationId: string,
  actualPoints: number,
) {
  const authorization = await tx.seriesGenerationAuthorization.findUnique({
    where: { operationId },
    include: { approval: { select: { id: true, requestedPoints: true, consumedPoints: true, status: true } } },
  })
  if (!authorization) return
  if (authorization.status === 'CONSUMED') return
  if (authorization.status !== 'RESERVED') throw new SeriesGenerationAuthorizationError('SERIES_AUTHORIZATION_RELEASED')
  if (actualPoints < 0 || actualPoints > authorization.points) throw new SeriesGenerationAuthorizationError('SERIES_AUTHORIZATION_EXCEEDED')

  const unused = authorization.points - actualPoints
  if (authorization.approval && unused > 0) {
    const restoredConsumed = Math.max(0, authorization.approval.consumedPoints - unused)
    await tx.seriesBatchApproval.update({
      where: { id: authorization.approval.id },
      data: {
        consumedPoints: restoredConsumed,
        status: restoredConsumed >= authorization.approval.requestedPoints ? 'CONSUMED' : 'APPROVED',
      },
    })
  }
  await tx.seriesGenerationAuthorization.update({
    where: { id: authorization.id },
    data: { status: 'CONSUMED', points: actualPoints },
  })
}

export async function releaseSeriesGenerationAuthorization(operationId: string | null | undefined) {
  if (!operationId) return
  await prisma.$transaction(async (tx) => {
    const authorization = await tx.seriesGenerationAuthorization.findUnique({
      where: { operationId },
      include: { approval: { select: { id: true, requestedPoints: true, consumedPoints: true } } },
    })
    if (!authorization || authorization.status !== 'RESERVED') return
    const released = await tx.seriesGenerationAuthorization.updateMany({
      where: { id: authorization.id, status: 'RESERVED' },
      data: { status: 'RELEASED' },
    })
    if (released.count !== 1 || !authorization.approval) return
    const restoredConsumed = Math.max(0, authorization.approval.consumedPoints - authorization.points)
    await tx.seriesBatchApproval.update({
      where: { id: authorization.approval.id },
      data: { consumedPoints: restoredConsumed, status: 'APPROVED' },
    })
  }, { isolationLevel: 'Serializable' })
}
