export type CreativeBeatView = {
  title: string
  content: string
  evidence?: string
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readableText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(readableText).filter(Boolean).join('、')
  return ''
}

function firstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = readableText(record[key])
    if (text) return text
  }
  return ''
}

/**
 * Creative agents have historically emitted several equivalent key-beat
 * schemas. Keep old projects readable while the prompt converges on
 * stage/content/evidence.
 */
export function normalizeCreativeKeyBeats(value: unknown): CreativeBeatView[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const beat = recordOf(item)
    const title = firstText(beat, ['stage', 'beat', 'name', 'title', 'label', 'phase'])
      || `情节点 ${index + 1}`
    const content = firstText(beat, [
      'content',
      'audienceTakeaway',
      'description',
      'summary',
      'development',
      'action',
      'purpose',
    ]) || '该节点的展开内容尚未填写'
    const evidence = firstText(beat, [
      'evidence',
      'proofMaterial',
      'judgmentBasis',
      'basis',
      'rationale',
      'reason',
    ])
    return { title, content, ...(evidence ? { evidence } : {}) }
  })
}
