export const STRUCTURED_CONTENT_TYPES = new Set([
  'CHARACTER_CARD', 'ENVIRONMENT_SETTING', 'STORY_TEMPLATE', 'STYLE_GUIDE', 'TEXT',
] as const)

const LIMITS = { short: 200, long: 4000, list: 30 }
const ALLOWED_CONSTRAINT_FIELDS: Record<string, string[]> = {
  CHARACTER_CARD: ['name', 'aliases', 'identityMode', 'role', 'narrativeFunction', 'summary', 'personality', 'motivations', 'recurringBehaviors', 'taboos', 'visualNotes', 'relationships'],
  ENVIRONMENT_SETTING: ['name', 'summary', 'locations', 'hardRules', 'softRules', 'mood', 'timePeriod', 'visualNotes'],
  STORY_TEMPLATE: ['name', 'premise', 'beats', 'hardConstraints', 'softConstraints', 'endingPattern', 'forbiddenPatterns'],
  STYLE_GUIDE: ['name', 'visualLanguage', 'palette', 'cameraRules', 'negativeRules', 'examples'],
  TEXT: ['title', 'body'],
}

function text(value: unknown, max = LIMITS.long): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function list(value: unknown, maxItems = LIMITS.list): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => text(item, 500)).filter(Boolean).slice(0, maxItems)
}

/** Keep structured assets declarative and bounded before they can enter prompt adapters. */
export function sanitizeStructuredPayload(contentType: string, raw: unknown): Record<string, unknown> {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  switch (contentType) {
    case 'CHARACTER_CARD': return {
      name: text(input.name, LIMITS.short), aliases: list(input.aliases),
      identityMode: input.identityMode === 'PLOT_FUNCTION_ONLY' ? 'PLOT_FUNCTION_ONLY' : 'DEFINED_PERSONA',
      role: text(input.role, LIMITS.short), narrativeFunction: text(input.narrativeFunction, 1000),
      summary: text(input.summary), personality: list(input.personality), motivations: list(input.motivations),
      recurringBehaviors: list(input.recurringBehaviors), taboos: list(input.taboos),
      visualNotes: text(input.visualNotes), relationships: list(input.relationships),
    }
    case 'ENVIRONMENT_SETTING': return {
      name: text(input.name, LIMITS.short), summary: text(input.summary), locations: list(input.locations),
      hardRules: list(input.hardRules), softRules: list(input.softRules), mood: text(input.mood, 1000),
      timePeriod: text(input.timePeriod, LIMITS.short), visualNotes: text(input.visualNotes),
    }
    case 'STORY_TEMPLATE': return {
      name: text(input.name, LIMITS.short), premise: text(input.premise), beats: list(input.beats),
      hardConstraints: list(input.hardConstraints), softConstraints: list(input.softConstraints),
      endingPattern: text(input.endingPattern, 1000), forbiddenPatterns: list(input.forbiddenPatterns),
    }
    case 'STYLE_GUIDE': return {
      name: text(input.name, LIMITS.short), visualLanguage: text(input.visualLanguage), palette: list(input.palette, 20),
      cameraRules: list(input.cameraRules), negativeRules: list(input.negativeRules), examples: list(input.examples),
    }
    case 'TEXT': return { title: text(input.title, LIMITS.short), body: text(input.body, 12_000) }
    default: throw new Error('STRUCTURED_TYPE_INVALID')
  }
}

export function structuredKind(contentType: string) {
  if (contentType === 'CHARACTER_CARD') return 'CHARACTER'
  if (contentType === 'ENVIRONMENT_SETTING') return 'ENVIRONMENT'
  if (contentType === 'STORY_TEMPLATE') return 'STORY'
  if (contentType === 'STYLE_GUIDE') return 'STYLE'
  return 'TEXT'
}

export function selectConstraintPayload(contentType: string, payload: unknown, selectedFields?: unknown) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  const allowed = ALLOWED_CONSTRAINT_FIELDS[contentType] || []
  const selected = Array.isArray(selectedFields) ? selectedFields.filter((field): field is string => typeof field === 'string' && allowed.includes(field)) : allowed
  return Object.fromEntries(selected.filter((field) => source[field] !== undefined && source[field] !== '' && (!Array.isArray(source[field]) || (source[field] as unknown[]).length > 0)).map((field) => [field, source[field]]))
}
