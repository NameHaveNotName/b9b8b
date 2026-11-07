export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { hasUsefulSeriesBible, sanitizeSeriesBible } from '@/lib/series'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const series = await prisma.storySeries.findMany({
    where: { status: 'ACTIVE', OR: [{ userId: user.id }, { members: { some: { userId: user.id, status: 'ACTIVE' } } }] },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { episodes: true } },
      seasons: { orderBy: { seasonNumber: 'asc' }, select: { id: true, seasonNumber: true, title: true } },
      members: { where: { userId: user.id, status: 'ACTIVE' }, select: { role: true, assignedEpisodeIds: true } },
    },
  })
  return NextResponse.json({ series: series.map((item) => ({ ...item, accessRole: item.userId === user.id ? 'OWNER' : item.members[0]?.role || 'MEMBER', assignedEpisodeIds: item.members[0]?.assignedEpisodeIds || [], members: undefined })) })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  const logline = typeof body.logline === 'string' ? body.logline.trim().slice(0, 4000) : ''
  if (!title) return NextResponse.json({ error: 'VALIDATION_001', message: '系列名称不能为空' }, { status: 400 })
  const bible = sanitizeSeriesBible(body.bible)
  if (!hasUsefulSeriesBible(bible)) bible.premise = logline

  const created = await prisma.$transaction(async (tx) => {
    const series = await tx.storySeries.create({ data: { userId: user.id, title, logline: logline || null } })
    const season = await tx.storySeason.create({ data: { seriesId: series.id, seasonNumber: 1, title: '第 1 季' } })
    const bibleRevision = await tx.seriesBibleRevision.create({
      data: { seriesId: series.id, revisionNumber: 1, payload: bible, createdById: user.id },
    })
    return { series, season, bibleRevision }
  })
  return NextResponse.json(created, { status: 201 })
}
