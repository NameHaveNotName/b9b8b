export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getSeriesAccess } from '@/lib/series-access'

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const access = await getSeriesAccess(id, user.id, 'READ')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const series = await prisma.storySeries.findFirst({
    where: { id, status: 'ACTIVE' },
    include: {
      seasons: { orderBy: { seasonNumber: 'asc' } },
      bibleRevisions: { orderBy: { revisionNumber: 'desc' }, take: 1 },
      episodes: {
        orderBy: [{ season: { seasonNumber: 'asc' } }, { episodeNumber: 'asc' }],
        include: {
          season: { select: { seasonNumber: true, title: true } },
          project: { select: { id: true, title: true, status: true, updatedAt: true } },
          bibleRevision: { select: { revisionNumber: true } },
        },
      },
    },
  })
  if (!series) return NextResponse.json({ error: 'SERIES_404' }, { status: 404 })
  return NextResponse.json({ series: { ...series, accessRole: access.role, assignedEpisodeIds: access.assignedEpisodeIds } })
}
