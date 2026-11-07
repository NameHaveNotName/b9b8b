export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { diffSeriesBible, hasUsefulSeriesBible, sanitizeSeriesBible } from '@/lib/series'
import { getSeriesAccess } from '@/lib/series-access'

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const access = await getSeriesAccess(id, user.id, 'BIBLE_EDIT')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const body = await req.json().catch(() => ({}))
  const baseVersion = Number(body.baseVersion)
  const action = body.action === 'apply' ? 'apply' : 'preview'
  if (!Number.isInteger(baseVersion) || baseVersion < 1) return NextResponse.json({ error: 'VERSION_INVALID' }, { status: 400 })
  const series = await prisma.storySeries.findFirst({
    where: { id, status: 'ACTIVE' },
    include: { bibleRevisions: { where: { revisionNumber: baseVersion }, take: 1 }, episodes: { select: { id: true, bibleRevision: { select: { revisionNumber: true } } } } },
  })
  if (!series) return NextResponse.json({ error: 'SERIES_404' }, { status: 404 })
  if (series.currentBibleVersion !== baseVersion || !series.bibleRevisions[0]) return NextResponse.json({ error: 'BIBLE_STALE', message: '系列圣经已有新版本，请刷新后重试' }, { status: 409 })
  const nextPayload = sanitizeSeriesBible(body.bible)
  if (!hasUsefulSeriesBible(nextPayload)) return NextResponse.json({ error: 'BIBLE_EMPTY', message: '系列圣经不能全部为空' }, { status: 400 })
  const changes = diffSeriesBible(series.bibleRevisions[0].payload, nextPayload)
  if (changes.length === 0) return NextResponse.json({ error: 'BIBLE_UNCHANGED', message: '没有检测到修改' }, { status: 400 })
  const affectedEpisodes = series.episodes.filter((episode) => episode.bibleRevision.revisionNumber === baseVersion).length
  if (action === 'preview') return NextResponse.json({ baseVersion, nextVersion: baseVersion + 1, changes, affectedEpisodes })

  try {
    const revision = await prisma.$transaction(async (tx) => {
      const updated = await tx.storySeries.updateMany({ where: { id, currentBibleVersion: baseVersion }, data: { currentBibleVersion: baseVersion + 1 } })
      if (updated.count !== 1) throw new Error('BIBLE_STALE')
      return tx.seriesBibleRevision.create({ data: { seriesId: id, revisionNumber: baseVersion + 1, payload: nextPayload, createdById: user.id } })
    })
    return NextResponse.json({ revision, changes, affectedEpisodes })
  } catch (error: any) {
    if (error?.message === 'BIBLE_STALE' || error?.code === 'P2002') return NextResponse.json({ error: 'BIBLE_STALE', message: '系列圣经已有新版本，请刷新后重试' }, { status: 409 })
    throw error
  }
}
