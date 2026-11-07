export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getSeriesAccess } from '@/lib/series-access'
import { normalizeSeriesRole, sanitizeAssignedEpisodeIds, sanitizeSeriesBudgetPolicy } from '@/lib/series-team'
import { getSeriesBudgetState } from '@/lib/series-budget'

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const access = await getSeriesAccess(id, user.id, 'READ')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const series = await prisma.storySeries.findUniqueOrThrow({ where: { id }, select: { userId: true, monthlyPointBudget: true, batchGenerationLimit: true, requireBatchApproval: true, members: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, email: true, name: true } } } } } })
  const budget = await getSeriesBudgetState(id, series.monthlyPointBudget)
  return NextResponse.json({ role: access.role, ownerId: series.userId, policy: { monthlyPointBudget: series.monthlyPointBudget, batchGenerationLimit: series.batchGenerationLimit, requireBatchApproval: series.requireBatchApproval }, monthlyPointsUsed: budget.usedPoints, monthlyPointsReserved: budget.reservedPoints, monthlyPointsRemaining: budget.remainingPoints, members: series.members })
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const access = await getSeriesAccess(id, user.id, 'TEAM_MANAGE')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const body = await req.json().catch(() => ({}))
  if (body.action === 'policy') {
    const monthly = Number(body.monthlyPointBudget)
    const limit = Number(body.batchGenerationLimit)
    if (!Number.isInteger(monthly) || monthly < 0 || monthly > 10_000_000 || !Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: 'BUDGET_POLICY_INVALID', message: '月预算需为 0–1000 万点，单批集数需为 1–100' }, { status: 400 })
    const policy = sanitizeSeriesBudgetPolicy(body)
    await prisma.storySeries.update({ where: { id }, data: policy })
    return NextResponse.json({ policy })
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLocaleLowerCase() : ''
  const role = normalizeSeriesRole(body.role)
  if (!email || !role) return NextResponse.json({ error: 'VALIDATION_001', message: '邮箱或职责不正确' }, { status: 400 })
  const target = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true } })
  if (!target) return NextResponse.json({ error: 'USER_404', message: '没有找到该用户' }, { status: 404 })
  const series = await prisma.storySeries.findUniqueOrThrow({ where: { id }, select: { userId: true } })
  if (target.id === series.userId) return NextResponse.json({ error: 'OWNER_ROLE_FIXED', message: '系列负责人不需要重复加入成员表' }, { status: 409 })
  const assignedEpisodeIds = sanitizeAssignedEpisodeIds(body.assignedEpisodeIds)
  if (role === 'EPISODE_EDITOR' && assignedEpisodeIds.length === 0) return NextResponse.json({ error: 'EPISODE_ASSIGNMENT_REQUIRED', message: '单集编辑必须至少分配一集' }, { status: 400 })
  if (assignedEpisodeIds.length > 0) {
    const count = await prisma.storyEpisode.count({ where: { seriesId: id, id: { in: assignedEpisodeIds } } })
    if (count !== assignedEpisodeIds.length) return NextResponse.json({ error: 'EPISODE_ASSIGNMENT_INVALID', message: '分配列表包含不属于本系列的单集' }, { status: 400 })
  }
  const membership = await prisma.seriesMembership.upsert({ where: { seriesId_userId: { seriesId: id, userId: target.id } }, create: { seriesId: id, userId: target.id, role, assignedEpisodeIds, status: 'ACTIVE' }, update: { role, assignedEpisodeIds, status: 'ACTIVE' }, include: { user: { select: { id: true, email: true, name: true } } } })
  return NextResponse.json({ membership })
}
