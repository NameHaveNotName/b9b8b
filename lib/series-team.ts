export const SERIES_ROLES = ['WRITER', 'VISUAL', 'EPISODE_EDITOR', 'REVIEWER'] as const
export type SeriesRole = typeof SERIES_ROLES[number]

export type SeriesCapability = 'READ' | 'BIBLE_EDIT' | 'EPISODE_CREATE' | 'CONTINUITY_EDIT' | 'ASSET_MANAGE' | 'BATCH_REQUEST' | 'APPROVAL_REVIEW' | 'TEAM_MANAGE'

const ROLE_CAPABILITIES: Record<SeriesRole | 'OWNER', SeriesCapability[]> = {
  OWNER: ['READ', 'BIBLE_EDIT', 'EPISODE_CREATE', 'CONTINUITY_EDIT', 'ASSET_MANAGE', 'BATCH_REQUEST', 'APPROVAL_REVIEW', 'TEAM_MANAGE'],
  WRITER: ['READ', 'BIBLE_EDIT', 'EPISODE_CREATE', 'CONTINUITY_EDIT', 'BATCH_REQUEST'],
  VISUAL: ['READ', 'ASSET_MANAGE', 'BATCH_REQUEST'],
  EPISODE_EDITOR: ['READ', 'CONTINUITY_EDIT', 'BATCH_REQUEST'],
  REVIEWER: ['READ', 'APPROVAL_REVIEW'],
}

export function normalizeSeriesRole(value: unknown): SeriesRole | null {
  return typeof value === 'string' && SERIES_ROLES.includes(value as SeriesRole) ? value as SeriesRole : null
}

export function sanitizeAssignedEpisodeIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 100)
}

export function hasSeriesCapability(role: SeriesRole | 'OWNER', capability: SeriesCapability, assignedEpisodeIds: string[] = [], episodeId?: string) {
  if (!ROLE_CAPABILITIES[role].includes(capability)) return false
  if (role === 'EPISODE_EDITOR' && (capability === 'CONTINUITY_EDIT' || capability === 'BATCH_REQUEST')) return Boolean(episodeId && assignedEpisodeIds.includes(episodeId))
  return true
}

export function sanitizeSeriesBudgetPolicy(input: { monthlyPointBudget?: unknown; batchGenerationLimit?: unknown; requireBatchApproval?: unknown }) {
  const monthly = Number(input.monthlyPointBudget)
  const limit = Number(input.batchGenerationLimit)
  return {
    monthlyPointBudget: Number.isInteger(monthly) && monthly >= 0 && monthly <= 10_000_000 ? monthly : 0,
    batchGenerationLimit: Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 3,
    requireBatchApproval: input.requireBatchApproval !== false,
  }
}

export function assessSeriesBatchRequest(input: { episodeIds: unknown; requestedPoints: unknown; purpose: unknown; batchGenerationLimit: number; monthlyPointBudget: number; monthlyPointsUsed: number }) {
  const episodeIds = sanitizeAssignedEpisodeIds(input.episodeIds)
  const requestedPoints = Number(input.requestedPoints)
  const purpose = typeof input.purpose === 'string' ? input.purpose.trim().slice(0, 2000) : ''
  const issues: string[] = []
  if (episodeIds.length === 0) issues.push('EPISODES_REQUIRED')
  if (episodeIds.length > input.batchGenerationLimit) issues.push('BATCH_LIMIT_EXCEEDED')
  if (!Number.isInteger(requestedPoints) || requestedPoints <= 0 || requestedPoints > 10_000_000) issues.push('POINTS_INVALID')
  if (!purpose) issues.push('PURPOSE_REQUIRED')
  const remainingPoints = input.monthlyPointBudget > 0 ? Math.max(0, input.monthlyPointBudget - input.monthlyPointsUsed) : null
  if (remainingPoints !== null && requestedPoints > remainingPoints) issues.push('MONTHLY_BUDGET_EXCEEDED')
  return { allowed: issues.length === 0, issues, episodeIds, requestedPoints, purpose, remainingPoints }
}
