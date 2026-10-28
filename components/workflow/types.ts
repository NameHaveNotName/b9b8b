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
}

export interface GenerationRun {
  status: 'running' | 'completed' | 'failed'
  message: string
  startedAt?: string
  completedAt?: string
  previewUrl?: string
  previewType?: 'image' | 'video'
  isMock?: boolean
  error?: string
  requestSnapshot?: GenerationDraft
}
// End of generation workbench contracts.
