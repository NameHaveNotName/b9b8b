export type VideoReferenceRole =
  | 'identity'
  | 'environment'
  | 'continuity'
  | 'start_state'
  | 'key_composition'
  | 'action'
  | 'end_state'
  | 'style'

export interface VideoReferenceInput {
  url: string
  role: VideoReferenceRole
  label?: string | null
  shotIds?: string[]
  authority?: string | null
  exclude?: string[]
}
export interface VideoReferenceManifestItem {
  index: number
  url: string
  labels: string[]
  roles: VideoReferenceRole[]
  shotIds: string[]
  authorities: string[]
  excludes: string[]
}
const ROLE_ORDER: VideoReferenceRole[] = [
  'identity',
  'environment',
  'continuity',
  'start_state',
  'key_composition',
  'action',
  'end_state',
  'style',
]

function unique(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
}

/**
 * Produces the single numbered reference list shared by UI, prompt compiler and
 * provider request. Duplicate URLs are merged without losing their authorities.
 */
export function buildVideoReferenceManifest(
  inputs: VideoReferenceInput[],
  maxReferenceImages: number
): VideoReferenceManifestItem[] {
  if (!Number.isInteger(maxReferenceImages) || maxReferenceImages < 1) {
    throw new Error(`Invalid reference image limit: ${maxReferenceImages}`)
  }
  const byUrl = new Map<string, Omit<VideoReferenceManifestItem, 'index'>>()
  for (const input of inputs) {
    const url = input.url.trim()
    if (!url) throw new Error('Reference image URL cannot be empty')
    if (!ROLE_ORDER.includes(input.role)) throw new Error(`Invalid reference role: ${input.role}`)
    const existing = byUrl.get(url) || {
      url,
      labels: [],
      roles: [],
      shotIds: [],
      authorities: [],
      excludes: [],
    }
    existing.labels = unique([...existing.labels, input.label || ''])
    existing.roles = [...new Set([...existing.roles, input.role])]
      .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b))
    existing.shotIds = unique([...existing.shotIds, ...(input.shotIds || [])])
    existing.authorities = unique([...existing.authorities, input.authority || ''])
    existing.excludes = unique([...existing.excludes, ...(input.exclude || [])])
    byUrl.set(url, existing)
  }
  const manifest = [...byUrl.values()].map((item, index) => ({ index: index + 1, ...item }))
  if (manifest.length > maxReferenceImages) {
    throw new Error(`Reference image count ${manifest.length} exceeds limit ${maxReferenceImages}`)
  }
  return manifest
}

export function compileReferenceAuthorityMap(manifest: VideoReferenceManifestItem[]): string {
  if (!manifest.length) return ''
  const lines = manifest.map((item) => {
    const scope = item.shotIds.length ? `; shots: ${item.shotIds.join(', ')}` : ''
    const authority = item.authorities.length
      ? item.authorities.join('; ')
      : `use only for ${item.roles.join(' + ')}`
    const exclude = item.excludes.length ? `; do not inherit: ${item.excludes.join(', ')}` : ''
    return `REFERENCE IMAGE ${item.index} [${item.roles.join(' + ')}${scope}]: ${authority}${exclude}.`
  })
  return [
    'REFERENCE AUTHORITY MAP:',
    ...lines,
    'Each reference is authoritative only for the assigned roles. The shot timeline overrides unrelated image content.',
  ].join('\n')
}
