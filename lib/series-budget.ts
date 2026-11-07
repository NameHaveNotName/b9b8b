import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { monthStartUtc } from '@/lib/series-access'

export async function getSeriesBudgetState(seriesId: string, monthlyPointBudget: number, excludeApprovalId?: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const episodes = await client.storyEpisode.findMany({ where: { seriesId }, select: { projectId: true } })
  const [totals, approvals, activeAuthorizations] = await Promise.all([
    episodes.length > 0 ? client.operationLog.aggregate({ where: { projectId: { in: episodes.map((episode) => episode.projectId) }, status: { in: ['SUCCEEDED', 'PARTIAL'] }, createdAt: { gte: monthStartUtc() } }, _sum: { pointsCost: true, pointsRefunded: true } }) : null,
    client.seriesBatchApproval.findMany({ where: { seriesId, status: 'APPROVED', expiresAt: { gt: new Date() }, ...(excludeApprovalId ? { id: { not: excludeApprovalId } } : {}) }, select: { requestedPoints: true, consumedPoints: true } }),
    client.seriesGenerationAuthorization.aggregate({ where: { seriesId, status: 'RESERVED' }, _sum: { points: true } }),
  ])
  const usedPoints = Math.max(0, (totals?._sum.pointsCost || 0) - (totals?._sum.pointsRefunded || 0))
  const approvedRemainingPoints = approvals.reduce((sum, approval) => sum + Math.max(0, approval.requestedPoints - approval.consumedPoints), 0)
  const inFlightPoints = Math.max(0, activeAuthorizations._sum.points || 0)
  const reservedPoints = approvedRemainingPoints + inFlightPoints
  const committedPoints = usedPoints + reservedPoints
  return { usedPoints, reservedPoints, approvedRemainingPoints, inFlightPoints, committedPoints, remainingPoints: monthlyPointBudget > 0 ? Math.max(0, monthlyPointBudget - committedPoints) : null }
}
