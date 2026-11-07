export const MAX_INITIAL_PROJECT_ASSETS = 12

const SUPPORTED_INITIAL_ASSET_TYPES = new Set([
  'CHARACTER_CARD',
  'ENVIRONMENT_SETTING',
  'STORY_TEMPLATE',
  'STYLE_GUIDE',
])

export function normalizeInitialAssetIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)))
    .slice(0, MAX_INITIAL_PROJECT_ASSETS)
}

export function supportsInitialProjectImport(contentType: unknown): contentType is string {
  return typeof contentType === 'string' && SUPPORTED_INITIAL_ASSET_TYPES.has(contentType)
}

/**
 * Initial imports guide both early writing stages. They are deliberately soft:
 * the library asset should influence a new project without silently replacing
 * the user's new idea or locking the draft before it exists.
 */
export function buildInitialAssetConstraintSpecs() {
  return (['IDEATION', 'FRAMEWORK'] as const).map((targetStep) => ({
    targetStep,
    targetKey: '',
    interpretation: 'CONSTRAINTS' as const,
    strength: 'SOFT' as const,
    scope: 'PROJECT' as const,
    mergeStrategy: 'ADD' as const,
  }))
}
