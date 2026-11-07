export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getSeriesAccess } from '@/lib/series-access'

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; memberId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, memberId } = await props.params
  const access = await getSeriesAccess(id, user.id, 'TEAM_MANAGE')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const removed = await prisma.seriesMembership.updateMany({ where: { id: memberId, seriesId: id, status: 'ACTIVE' }, data: { status: 'REMOVED' } })
  if (removed.count === 0) return NextResponse.json({ error: 'MEMBER_404' }, { status: 404 })
  return NextResponse.json({ success: true })
}
