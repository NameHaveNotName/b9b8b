/* Shared types for workflow UI components */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type GenerationReferenceType =
  | 'original'
  | 'character'
  | 'style'
  | 'previous-shot'
  | 'user-upload'
  | 'user-dragged'
  | 'first-frame'
  | 'last-frame'
  | 'concept'
  | 'other'

export interface GenerationReference {
  url: string
  label: string
  type: GenerationReferenceType
  removable: boolean
}

export interface GenerationDraft {
  stepType: string
  kind: 'text' | 'image' | 'video' | 'music'
  targetId?: string
  actNumber?: number
  targetLabel: string
  prompt: string
  promptRequired?: boolean
  promptEditable?: boolean
  prompts?: Array<{
    id: string
    label: string
    text: string
    textField: string
    source: Record<string, any>
  }>
  references: GenerationReference[]
  referencesResolved?: boolean
  referencesEditable?: boolean
  assetConstraints?: Array<{
    id: string
    title: string
    contentType: string
    strength: string
    mergeStrategy: string
    payload: Record<string, any>
  }>
  originalImageUrl?: string | null
  editInstruction?: string
  model: string
  modelEditable?: boolean
  aspectRatio: string
  aspectRatioEditable?: boolean
  pointCost: number
  inputDeps: string[]
  isRetry?: boolean
  requestBody?: Record<string, any>
  /** 客户端实际提交时刻，用于把快照关联到正确的 OperationLog。 */
  submittedAt?: string
}

export interface GenerationRun {
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  message: string
  taskId?: string
  stage?: string
  rawStatus?: string
  startedAt?: string
  completedAt?: string
  previewUrl?: string
  previewType?: 'image' | 'video'
  isMock?: boolean
  error?: string
  requestSnapshot?: GenerationDraft
  attempts?: Array<{
    id: string
    provider: string
    model?: string | null
    status: string
    attemptNo?: number | null
    externalTaskId?: string | null
    httpStatus?: number | null
    startedAt?: string
    completedAt?: string | null
    durationMs?: number | null
    error?: string | null
    stageId?: string
    stageLabel?: string
    outputAvailable?: boolean
    outputText?: string
  }>
}
// End of generation workbench contracts.
