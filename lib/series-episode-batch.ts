import { createHash } from 'node:crypto'
import { normalizeEpisodeNumber } from './series.ts'

export const MAX_BATCH_EPISODES = 12

export type BatchEpisodeDraft = {
  episodeNumber: number
  title: string
  synopsis: string
}

function renderTemplate(template: string, episodeNumber: number) {
  return template
    .replaceAll('{集数}', String(episodeNumber))
    .replaceAll('{n}', String(episodeNumber))
}

export function buildBatchEpisodeDrafts(input: {
  startEpisodeNumber: unknown
  count: unknown
  titlePattern: unknown
  synopsisTemplate?: unknown
}): BatchEpisodeDraft[] {
  const startEpisodeNumber = normalizeEpisodeNumber(input.startEpisodeNumber)
  const count = Number(input.count)
  if (!startEpisodeNumber || !Number.isInteger(count) || count < 2 || count > MAX_BATCH_EPISODES) {
    throw new Error('BATCH_EPISODE_RANGE_INVALID')
  }
  const titlePattern = typeof input.titlePattern === 'string' ? input.titlePattern.trim() : ''
  const synopsisTemplate = typeof input.synopsisTemplate === 'string' ? input.synopsisTemplate.trim() : ''
  if (!titlePattern) throw new Error('BATCH_EPISODE_TITLE_REQUIRED')

  return Array.from({ length: count }, (_, index) => {
    const episodeNumber = startEpisodeNumber + index
    if (!normalizeEpisodeNumber(episodeNumber)) throw new Error('BATCH_EPISODE_RANGE_INVALID')
    const title = renderTemplate(titlePattern, episodeNumber).trim().slice(0, 200)
    if (!title) throw new Error('BATCH_EPISODE_TITLE_REQUIRED')
    return {
      episodeNumber,
      title,
      synopsis: renderTemplate(synopsisTemplate, episodeNumber).trim().slice(0, 12_000),
    }
  })
}

export function batchEpisodeDraftHash(drafts: BatchEpisodeDraft[]) {
  return createHash('sha256').update(JSON.stringify(drafts)).digest('hex')
}

export function sameIdSet(left: unknown, right: string[]) {
  if (!Array.isArray(left) || left.some((item) => typeof item !== 'string')) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}
