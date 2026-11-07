export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getSeriesAccess } from '@/lib/series-access'

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; assetId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, assetId } = await props.params
  const access = await getSeriesAccess(id, user.id, 'ASSET_MANAGE')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const updated = await prisma.seriesAsset.updateMany({ where: { id: assetId, seriesId: id, enabled: true }, data: { enabled: false } })
  if (updated.count !== 1) return NextResponse.json({ error: 'SERIES_ASSET_404' }, { status: 404 })
  return NextResponse.json({ success: true })
}
