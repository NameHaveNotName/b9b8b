/* Shared types for workflow UI components */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type InspectorView = 'task-queue' | 'generation-confirm' | 'result-feedback'

export interface WorkflowStep {
  id: string
  stepType: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  order: number
  startedAt?: string | null
  completedAt?: string | null
  errorMessage?: string | null
  outputData?: any
  resultAssets?: any[]
}

export interface AssetDecisionData {
  id: string
  type: 'style' | 'character' | 'concept' | 'trailer' | 'keyframes' | 'video' | 'storyboard'
  name: string
  description?: string
  imageUrl?: string
  videoUrl?: string
  thumbnailUrl?: string
  metadata?: Record<string, unknown>
  isSelected?: boolean
  is基准?: boolean
  downstreamSteps?: string[]
  isRegenerating?: boolean
  isMock?: boolean
  mockReason?: string
  modelNo?: number
  imageModel?: string
}

export interface InspectorTask {
  id: string
  stepType: string
  label: string
  priority: 'high' | 'normal' | 'low'
  category: 'suggested' | 'failed' | 'available' | 'waiting' | 'iterable'
  errorMessage?: string
  suggestion?: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'AVAILABLE'
  actNumber?: number
  downstreamSteps?: string[]
}

export interface GenerationConfirmData {
  stepType: string
  inputDeps: string[]
  model: string
  aspectRatio: string
  duration?: number
  bgmStrategy?: string
  prompt: string
  pointCost: number
  asset?: AssetDecisionData
}

export interface ResultFeedbackData {
  step: WorkflowStep
  stages: Array<{
    name: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    progress?: number
    error?: string
  }>
  previewUrl?: string
  partialSuccess?: boolean
  failedReason?: string
  preservedAssets?: string[]
  retryWillConsume前置?: boolean
}
