export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getSeriesAccess } from '@/lib/series-access'
import { getSeriesBudgetState } from '@/lib/series-budget'

export async function PATCH(req: Request, props: { params: Promise<{ id: string; requestId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, requestId } = await props.params
  const access = await getSeriesAccess(id, user.id, 'APPROVAL_REVIEW')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const body = await req.json().catch(() => ({}))
  const decision = body.decision === 'APPROVED' ? 'APPROVED' : body.decision === 'REJECTED' ? 'REJECTED' : null
  if (!decision) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
  try {
    await prisma.$transaction(async (tx) => {
      const approval = await tx.seriesBatchApproval.findFirst({ where: { id: requestId, seriesId: id, status: 'PENDING' }, select: { requestedPoints: true, series: { select: { monthlyPointBudget: true } } } })
      if (!approval) throw new Error('APPROVAL_STALE')
      if (decision === 'APPROVED') {
        const budget = await getSeriesBudgetState(id, approval.series.monthlyPointBudget, requestId, tx)
        if (budget.remainingPoints !== null && approval.requestedPoints > budget.remainingPoints) throw Object.assign(new Error('MONTHLY_BUDGET_EXCEEDED'), { remainingPoints: budget.remainingPoints })
      }
      const updated = await tx.seriesBatchApproval.updateMany({ where: { id: requestId, seriesId: id, status: 'PENDING' }, data: { status: decision, decisionNote: note || null, reviewedById: user.id, decidedAt: new Date(), expiresAt: decision === 'APPROVED' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null } })
      if (updated.count !== 1) throw new Error('APPROVAL_STALE')
    }, { isolationLevel: 'Serializable' })
    return NextResponse.json({ success: true, status: decision })
  } catch (error: any) {
    if (error?.message === 'APPROVAL_STALE') return NextResponse.json({ error: 'APPROVAL_STALE', message: '申请已经被处理' }, { status: 409 })
    if (error?.message === 'MONTHLY_BUDGET_EXCEEDED') return NextResponse.json({ error: 'MONTHLY_BUDGET_EXCEEDED', message: '当前剩余额度不足，不能批准该申请', remainingPoints: error.remainingPoints }, { status: 409 })
    if (error?.code === 'P2034') return NextResponse.json({ error: 'APPROVAL_CONFLICT', message: '同时有其他审批操作，请重试' }, { status: 409 })
    throw error
  }
}
