export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getSeriesAccess } from '@/lib/series-access'
import { assessSeriesBatchRequest } from '@/lib/series-team'
import { getSeriesBudgetState } from '@/lib/series-budget'

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const access = await getSeriesAccess(id, user.id, 'READ')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const requests = await prisma.seriesBatchApproval.findMany({ where: { seriesId: id }, orderBy: { createdAt: 'desc' }, take: 50, include: { requestedBy: { select: { id: true, name: true, email: true } }, reviewedBy: { select: { id: true, name: true, email: true } } } })
  return NextResponse.json({ requests, canReview: access.role === 'OWNER' || access.role === 'REVIEWER' })
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const body = await req.json().catch(() => ({}))
  const candidateEpisodeIds = Array.isArray(body.episodeIds) ? body.episodeIds.filter((item: unknown) => typeof item === 'string') : []
  const access = await getSeriesAccess(id, user.id, 'BATCH_REQUEST', candidateEpisodeIds[0])
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  if (access.role === 'EPISODE_EDITOR' && candidateEpisodeIds.some((episodeId: string) => !access.assignedEpisodeIds.includes(episodeId))) return NextResponse.json({ error: 'SERIES_403' }, { status: 403 })
  const series = await prisma.storySeries.findUniqueOrThrow({ where: { id }, select: { monthlyPointBudget: true, batchGenerationLimit: true, requireBatchApproval: true, episodes: { select: { id: true, projectId: true } } } })
  const budget = await getSeriesBudgetState(id, series.monthlyPointBudget)
  const assessment = assessSeriesBatchRequest({ ...body, batchGenerationLimit: series.batchGenerationLimit, monthlyPointBudget: series.monthlyPointBudget, monthlyPointsUsed: budget.committedPoints })
  const validEpisodeIds = new Set(series.episodes.map((episode) => episode.id))
  if (assessment.episodeIds.some((episodeId) => !validEpisodeIds.has(episodeId))) assessment.issues.push('EPISODE_NOT_IN_SERIES')
  if (assessment.issues.length > 0) return NextResponse.json({ error: 'BATCH_REQUEST_INVALID', issues: assessment.issues, remainingPoints: assessment.remainingPoints }, { status: 400 })
  const status = series.requireBatchApproval || series.monthlyPointBudget > 0 ? 'PENDING' : 'APPROVED'
  const approval = await prisma.seriesBatchApproval.create({ data: { seriesId: id, requestedById: user.id, episodeIds: assessment.episodeIds, requestedPoints: assessment.requestedPoints, purpose: assessment.purpose, status, reviewedById: status === 'APPROVED' ? user.id : null, decidedAt: status === 'APPROVED' ? new Date() : null, expiresAt: status === 'APPROVED' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null } })
  return NextResponse.json({ approval }, { status: 201 })
}
