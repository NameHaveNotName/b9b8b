export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser()
  if (!admin?.isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await props.params
  const body = await req.json().catch(() => ({}))
  const providerCost = Number(body?.providerCost)
  const currency = String(body?.currency || 'USD').trim().toUpperCase()
  if (!Number.isFinite(providerCost) || providerCost < 0 || providerCost > 1_000_000) {
    return NextResponse.json({ error: 'INVALID_PROVIDER_COST' }, { status: 400 })
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json({ error: 'INVALID_CURRENCY' }, { status: 400 })
  }

  const attempt = await prisma.providerCallAttempt.update({
    where: { id },
    data: { providerCost, currency, costSource: 'ACTUAL', reconciledAt: new Date() },
    select: { operationId: true },
  }).catch(() => null)
  if (!attempt) return NextResponse.json({ error: 'ATTEMPT_NOT_FOUND' }, { status: 404 })

  const attempts = await prisma.providerCallAttempt.findMany({
    where: { operationId: attempt.operationId, providerCost: { not: null } },
    select: { providerCost: true, currency: true, costSource: true },
  })
  const currencies = [...new Set(attempts.map((item: any) => item.currency).filter(Boolean))]
  const allAttempts = await prisma.providerCallAttempt.count({ where: { operationId: attempt.operationId } })
  const complete = attempts.length === allAttempts && currencies.length === 1
  const total = currencies.length === 1
    ? attempts.reduce((sum: number, item: any) => sum + Number(item.providerCost), 0)
    : null

  await prisma.operationLog.update({
    where: { id: attempt.operationId },
    data: {
      providerCost: total == null ? null : total.toFixed(8),
      currency: total == null ? null : currencies[0],
      costSource: complete && attempts.every((item: any) => item.costSource === 'ACTUAL')
        ? 'ACTUAL'
        : 'PARTIAL',
    },
  })

  return NextResponse.json({ success: true, operationId: attempt.operationId })
}
