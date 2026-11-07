export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { assessSeriesConsistency } from '@/lib/series-consistency'
import { getSeriesAccess } from '@/lib/series-access'

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const access = await getSeriesAccess(id, user.id, 'READ')
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: access.reason === 'SERIES_404' ? 404 : 403 })
  const series = await prisma.storySeries.findFirst({
    where: { id, status: 'ACTIVE' },
    select: {
      currentBibleVersion: true,
      episodes: {
        orderBy: [{ season: { seasonNumber: 'asc' } }, { episodeNumber: 'asc' }],
        select: {
          episodeNumber: true,
          continuityBefore: true,
          continuityAfter: true,
          bibleRevision: { select: { revisionNumber: true, payload: true } },
          project: {
            select: {
              steps: { where: { stepType: { in: ['FRAMEWORK', 'STORYBOARD'] } }, select: { stepType: true, outputData: true } },
              voiceoverSegments: { select: { shotId: true, speaker: true, sequence: true, text: true } },
            },
          },
        },
      },
    },
  })
  if (!series) return NextResponse.json({ error: 'SERIES_404' }, { status: 404 })
  const episodes = series.episodes.map((episode) => ({
    episodeNumber: episode.episodeNumber,
    bibleRevisionNumber: episode.bibleRevision.revisionNumber,
    biblePayload: episode.bibleRevision.payload,
    continuityBefore: episode.continuityBefore,
    continuityAfter: episode.continuityAfter,
    framework: episode.project.steps.find((step) => step.stepType === 'FRAMEWORK')?.outputData,
    storyboard: episode.project.steps.find((step) => step.stepType === 'STORYBOARD')?.outputData,
    voiceovers: episode.project.voiceoverSegments,
  }))
  return NextResponse.json(assessSeriesConsistency(episodes, series.currentBibleVersion))
}
