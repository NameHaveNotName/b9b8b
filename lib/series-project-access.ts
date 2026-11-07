import type { WorkflowStepType } from '@prisma/client'
import { normalizeSeriesRole, sanitizeAssignedEpisodeIds, type SeriesRole } from './series-team.ts'

export type SeriesProjectRole = SeriesRole | 'OWNER'

const WRITER_STEPS: WorkflowStepType[] = ['IDEATION', 'FRAMEWORK', 'STORYBOARD']
const VISUAL_STEPS: WorkflowStepType[] = ['STYLE', 'CHARACTER', 'CONCEPT', 'TRAILER', 'KEYFRAMES', 'VIDEO_DIRECT']

export function editableSeriesProjectSteps(role: unknown, assignedEpisodeIds: unknown, episodeId: string) {
  if (role === 'OWNER') return [...WRITER_STEPS, ...VISUAL_STEPS]
  const normalized = normalizeSeriesRole(role)
  if (normalized === 'WRITER') return WRITER_STEPS
  if (normalized === 'VISUAL') return VISUAL_STEPS
  if (normalized === 'EPISODE_EDITOR' && sanitizeAssignedEpisodeIds(assignedEpisodeIds).includes(episodeId)) return [...WRITER_STEPS, ...VISUAL_STEPS]
  return []
}

export function seriesRoleCanReadProject(role: unknown, assignedEpisodeIds: unknown, episodeId: string) {
  if (role === 'OWNER') return true
  const normalized = normalizeSeriesRole(role)
  if (!normalized) return false
  if (normalized === 'EPISODE_EDITOR') return sanitizeAssignedEpisodeIds(assignedEpisodeIds).includes(episodeId)
  return true
}

export function seriesRoleCanEditProjectStep(role: unknown, assignedEpisodeIds: unknown, episodeId: string, stepType: WorkflowStepType) {
  if (!seriesRoleCanReadProject(role, assignedEpisodeIds, episodeId)) return false
  const normalizedRole = role === 'OWNER' ? 'OWNER' : normalizeSeriesRole(role)
  return normalizedRole ? editableSeriesProjectSteps(normalizedRole, assignedEpisodeIds, episodeId).includes(stepType) : false
}
