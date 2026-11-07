function contentText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 20_000)
  if (!Array.isArray(value)) return undefined
  const joined = value.map((item) => {
    if (typeof item === 'string') return item
    if (!item || typeof item !== 'object') return ''
    const record = item as Record<string, unknown>
    return typeof record.text === 'string' ? record.text : typeof record.content === 'string' ? record.content : ''
  }).filter(Boolean).join('\n')
  return joined.trim() ? joined.trim().slice(0, 20_000) : undefined
}

export function extractAssistantOutput(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const root = data as Record<string, any>
  const candidates = [
    root.choices?.[0]?.message?.content,
    root.choices?.[0]?.text,
    root.output,
    root.output_text,
    root.data?.choices?.[0]?.message?.content,
    root.data?.output,
  ]
  for (const candidate of candidates) {
    const text = contentText(candidate)
    if (text) return text
  }
  return undefined
}
