import { prisma } from '@/lib/prisma'
import { hasSeriesCapability, normalizeSeriesRole, sanitizeAssignedEpisodeIds, type SeriesCapability } from '@/lib/series-team'

export async function getSeriesAccess(seriesId: string, userId: string, capability: SeriesCapability, episodeId?: string) {
  const series = await prisma.storySeries.findFirst({ where: { id: seriesId, status: 'ACTIVE' }, select: { id: true, userId: true } })
  if (!series) return { allowed: false as const, reason: 'SERIES_404' }
  if (series.userId === userId) return { allowed: true as const, role: 'OWNER' as const, assignedEpisodeIds: [] }
  const membership = await prisma.seriesMembership.findUnique({ where: { seriesId_userId: { seriesId, userId } } })
  if (!membership || membership.status !== 'ACTIVE') return { allowed: false as const, reason: 'SERIES_403' }
  const assignedEpisodeIds = sanitizeAssignedEpisodeIds(membership.assignedEpisodeIds)
  const role = normalizeSeriesRole(membership.role)
  if (!role) return { allowed: false as const, reason: 'SERIES_403' }
  if (!hasSeriesCapability(role, capability, assignedEpisodeIds, episodeId)) return { allowed: false as const, reason: 'SERIES_403' }
  return { allowed: true as const, role, assignedEpisodeIds, membershipId: membership.id }
}

export function monthStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}
