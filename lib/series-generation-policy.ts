export function selectApplicableSeriesApproval<T extends {
  status: string
  requestedById: string
  episodeIds: unknown
  requestedPoints: number
  consumedPoints: number
  expiresAt: Date | null
}>(candidates: T[], input: { userId: string; episodeId: string; points: number; now?: Date }): T | null {
  const now = input.now || new Date()
  return candidates.find((item) =>
    item.status === 'APPROVED'
    && item.requestedById === input.userId
    && Boolean(item.expiresAt && item.expiresAt > now)
    && Array.isArray(item.episodeIds)
    && item.episodeIds.some((episodeId) => episodeId === input.episodeId)
    && item.requestedPoints - item.consumedPoints >= input.points,
  ) || null
}

export function canReserveSeriesBudget(remainingPoints: number | null, points: number): boolean {
  return points >= 0 && (remainingPoints === null || points <= remainingPoints)
}
