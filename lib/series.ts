export const SERIES_BIBLE_LIMITS = {
  listItems: 100,
  listItemLength: 500,
  longTextLength: 12_000,
} as const

function text(value: unknown, max: number = SERIES_BIBLE_LIMITS.longTextLength) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function list(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, SERIES_BIBLE_LIMITS.listItemLength))
    .filter(Boolean)
    .slice(0, SERIES_BIBLE_LIMITS.listItems)
}

export type SeriesBiblePayload = ReturnType<typeof sanitizeSeriesBible>

/** The series bible is bounded data, never an executable prompt fragment. */
export function sanitizeSeriesBible(raw: unknown) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return {
    premise: text(input.premise),
    longArc: text(input.longArc),
    characters: list(input.characters),
    relationships: list(input.relationships),
    locations: list(input.locations),
    worldRules: list(input.worldRules),
    visualStyle: text(input.visualStyle, 4000),
    forbiddenPatterns: list(input.forbiddenPatterns),
  }
}

export function hasUsefulSeriesBible(payload: SeriesBiblePayload) {
  return Object.values(payload).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value))
}

export function normalizeEpisodeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : null
}

export function buildSeriesBibleConstraintPayload(seriesTitle: string, revisionNumber: number, payload: SeriesBiblePayload) {
  return {
    title: `${seriesTitle} · 系列圣经 v${revisionNumber}`,
    body: JSON.stringify(payload),
  }
}

export type SeriesBibleChange = { field: keyof SeriesBiblePayload; before: string | string[]; after: string | string[] }

export function diffSeriesBible(beforeRaw: unknown, afterRaw: unknown): SeriesBibleChange[] {
  const before = sanitizeSeriesBible(beforeRaw)
  const after = sanitizeSeriesBible(afterRaw)
  return (Object.keys(before) as Array<keyof SeriesBiblePayload>)
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, before: before[field], after: after[field] }))
}
