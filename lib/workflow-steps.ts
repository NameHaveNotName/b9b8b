import type { WorkflowStepType } from '@prisma/client'

export const WORKFLOW_STEP_TYPES: WorkflowStepType[] = [
  'IDEATION', 'FRAMEWORK', 'STYLE', 'CHARACTER', 'CONCEPT', 'TRAILER',
  'STORYBOARD', 'KEYFRAMES', 'VIDEO_DIRECT',
]

export function buildInitialWorkflowSteps(projectId: string) {
  return WORKFLOW_STEP_TYPES.map((stepType, order) => ({
    projectId,
    stepType,
    order,
    status: 'PENDING' as const,
  }))
}
