export type CreativeDirection = {
  title: string
  description: string
  keywords: string[]
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function creativeDisplayText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim() || fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const text = value.map(item => creativeDisplayText(item)).filter(Boolean).join('、')
    return text || fallback
  }
  if (isRecord(value)) {
    for (const key of ['text', 'title', 'label', 'name', 'summary', 'description', 'value']) {
      const text = creativeDisplayText(value[key])
      if (text) return text
    }
  }
  return fallback
}

function keywordTexts(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(keywordTexts)
  if (!isRecord(value)) return []

  // Agent outputs are not guaranteed to use a single schema. Prefer concise
  // labels and audience descriptors, and never leak a raw object into JSX.
  return ['keywords', 'tags', 'label', 'title', 'primary', 'value']
    .flatMap(key => keywordTexts(value[key]))
}

export function normalizeCreativeKeywords(...values: unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const text of values.flatMap(keywordTexts)) {
    const compact = text.replace(/\s+/g, ' ').trim()
    if (!compact) continue
    const display = compact.length > 40 ? `${compact.slice(0, 39)}…` : compact
    if (seen.has(display)) continue
    seen.add(display)
    result.push(display)
    if (result.length === 4) break
  }
  return result
}

export function normalizeCreativeDirection(value: unknown, index = 0): CreativeDirection {
  const input = isRecord(value) ? value : {}
  return {
    ...input,
    title: creativeDisplayText(input.title ?? input.label, `创意方向 ${index + 1}`),
    description: creativeDisplayText(input.description ?? input.summary ?? input.coreIdea),
    keywords: normalizeCreativeKeywords(input.keywords, input.label, input.audienceValue),
  }
}

export function normalizeCreativeDirections(value: unknown): CreativeDirection[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeCreativeDirection)
}
