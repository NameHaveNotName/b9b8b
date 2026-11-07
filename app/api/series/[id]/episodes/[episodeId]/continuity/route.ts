export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { assessEpisodeContinuity, episodeContinuityHash, hasUsefulEpisodeContinuity, sanitizeEpisodeContinuity } from '@/lib/series-continuity'
import { getSeriesAccess } from '@/lib/series-access'

async function accessibleEpisode(seriesId: string, episodeId: string, userId: string, edit: boolean) {
  const access = await getSeriesAccess(seriesId, userId, edit ? 'CONTINUITY_EDIT' : 'READ', episodeId)
  if (!access.allowed) return null
  return prisma.storyEpisode.findFirst({
    where: { id: episodeId, seriesId },
    select: { id: true, continuityBefore: true, continuityAfter: true, updatedAt: true },
  })
}

export async function GET(_req: Request, props: { params: Promise<{ id: string; episodeId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, episodeId } = await props.params
  const episode = await accessibleEpisode(id, episodeId, user.id, false)
  if (!episode) return NextResponse.json({ error: 'EPISODE_404' }, { status: 404 })
  const before = sanitizeEpisodeContinuity(episode.continuityBefore)
  const after = sanitizeEpisodeContinuity(episode.continuityAfter)
  return NextResponse.json({
    continuityBefore: episode.continuityBefore ? before : null,
    continuityAfter: episode.continuityAfter ? after : null,
    baseHash: episodeContinuityHash(episode.continuityAfter),
    issues: assessEpisodeContinuity(after, episode.continuityBefore ? before : null),
  })
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string; episodeId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id, episodeId } = await props.params
  const episode = await accessibleEpisode(id, episodeId, user.id, true)
  if (!episode) return NextResponse.json({ error: 'EPISODE_404' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  if (typeof body.baseHash !== 'string' || body.baseHash !== episodeContinuityHash(episode.continuityAfter)) {
    return NextResponse.json({ error: 'CONTINUITY_STALE', message: '连续性账本已在其他窗口更新，请刷新后重试' }, { status: 409 })
  }
  const next = sanitizeEpisodeContinuity(body.continuityAfter)
  if (!hasUsefulEpisodeContinuity(next)) return NextResponse.json({ error: 'CONTINUITY_EMPTY', message: '请至少填写一项结尾状态' }, { status: 400 })
  const updated = await prisma.storyEpisode.updateMany({ where: { id: episode.id, updatedAt: episode.updatedAt }, data: { continuityAfter: next } })
  if (updated.count !== 1) return NextResponse.json({ error: 'CONTINUITY_STALE', message: '连续性账本已被更新，请刷新后重试' }, { status: 409 })
  const before = episode.continuityBefore ? sanitizeEpisodeContinuity(episode.continuityBefore) : null
  return NextResponse.json({ continuityAfter: next, baseHash: episodeContinuityHash(next), issues: assessEpisodeContinuity(next, before) })
}
