export type AssetType = 'IMAGE' | 'VIDEO' | 'TEXT' | 'AUDIO' | 'REFERENCE';

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

export type WorkflowStepType =
  | 'IDEATION'
  | 'FRAMEWORK'
  | 'STYLE'
  | 'CHARACTER'
  | 'CONCEPT'
  | 'TRAILER'
  | 'STORYBOARD'
  | 'KEYFRAMES'
  | 'VIDEO_DIRECT'
  | 'VIDEO_RENDER'
  | 'CAMERA'
  | 'REVIEW';

export type StepStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
