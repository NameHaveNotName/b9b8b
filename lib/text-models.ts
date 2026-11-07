export const AUTO_TEXT_MODEL = 'auto'
export const MINIMAX_TEXT_MODEL = 'MiniMax-Text-01'

const LEGACY_ALIASES: Record<string, string> = {
  'deepseek-v3': 'deepseek-v3-1',
  'deepseek-chat': AUTO_TEXT_MODEL,
}

const TEXT_FAMILY_PATTERN = /(deepseek|gpt|claude|gemini|qwen|kimi|minimax|glm|mistral|llama|grok|yi-|doubao)/i
const NON_TEXT_PATTERN = /(image|img2|video|seedance|sora|veo|vidu|wan\d|tts|speech|audio|music|embedding|rerank|search-api)/i

const AUTO_PREFERENCE = [
  'deepseek-v3-1',
  'deepseek-v4-flash-0731',
  'deepseek-v4.1-flash',
  'gpt-4o-mini',
]

export interface TextModelOption {
  id: string
  label: string
  provider: 'auto' | 'minimax' | 'openlux'
}

export function normalizeTextModelId(model?: string | null): string {
  const value = String(model || '').trim()
  if (!value) return AUTO_TEXT_MODEL
  return LEGACY_ALIASES[value] || value
}

export function shouldUseMinimax(model?: string | null): boolean {
  return normalizeTextModelId(model) === MINIMAX_TEXT_MODEL
}

export function filterTextModelIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
    .filter((id) => TEXT_FAMILY_PATTERN.test(id) && !NON_TEXT_PATTERN.test(id))
    .sort((a, b) => a.localeCompare(b))
}

export function chooseAutomaticOpenLuxModel(ids: string[]): string | null {
  const available = filterTextModelIds(ids)
  for (const preferred of AUTO_PREFERENCE) {
    if (available.includes(preferred)) return preferred
  }
  return available.find((id) => /deepseek/i.test(id)) || available[0] || null
}

function modelLabel(id: string): string {
  if (id === AUTO_TEXT_MODEL) return '自动选择（推荐）'
  if (id === MINIMAX_TEXT_MODEL) return 'MiniMax · MiniMax-Text-01'
  if (/^deepseek/i.test(id)) return `DeepSeek · ${id}`
  return `OpenLux · ${id}`
}

export function buildTextModelOptions(openLuxIds: string[], minimaxConfigured: boolean): TextModelOption[] {
  const options: TextModelOption[] = [{ id: AUTO_TEXT_MODEL, label: modelLabel(AUTO_TEXT_MODEL), provider: 'auto' }]
  if (minimaxConfigured) {
    options.push({ id: MINIMAX_TEXT_MODEL, label: modelLabel(MINIMAX_TEXT_MODEL), provider: 'minimax' })
  }
  for (const id of filterTextModelIds(openLuxIds)) {
    options.push({ id, label: modelLabel(id), provider: 'openlux' })
  }
  return options
}
