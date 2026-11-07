import { createHash } from 'node:crypto'

const MAX_ITEMS = 100
const MAX_ITEM_LENGTH = 1000

function text(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, MAX_ITEM_LENGTH)).filter(Boolean).slice(0, MAX_ITEMS)
}

function objectList(value: unknown, fields: readonly string[]) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => Object.fromEntries(fields.map((field) => [field, text((item as Record<string, unknown>)[field], 500)])))
    .filter((item) => item.name).slice(0, MAX_ITEMS)
}

export function sanitizeEpisodeContinuity(raw: unknown) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return {
    storyTime: text(input.storyTime, 500),
    summary: text(input.summary, 8000),
    characters: objectList(input.characters, ['name', 'state', 'location', 'costume', 'injuries', 'knowledge']),
    props: objectList(input.props, ['name', 'state', 'holder', 'location']),
    occurredEvents: stringList(input.occurredEvents),
    openThreads: stringList(input.openThreads),
    resolvedThreads: stringList(input.resolvedThreads),
    locationChanges: stringList(input.locationChanges),
    notes: text(input.notes, 4000),
  }
}

export type EpisodeContinuity = ReturnType<typeof sanitizeEpisodeContinuity>

export function hasUsefulEpisodeContinuity(value: EpisodeContinuity) {
  return Object.values(value).some((item) => Array.isArray(item) ? item.length > 0 : Boolean(item))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]))
  return value
}

export function episodeContinuityHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(canonicalize(sanitizeEpisodeContinuity(value)))).digest('hex')
}

export type ContinuityIssue = { code: string; severity: 'WARNING' | 'INFO'; message: string }

export function assessEpisodeContinuity(after: EpisodeContinuity, before?: EpisodeContinuity | null): ContinuityIssue[] {
  const issues: ContinuityIssue[] = []
  const duplicates = (items: Array<{ name?: string }>) => {
    const seen = new Set<string>(); const repeated = new Set<string>()
    for (const item of items) { const key = (item.name || '').trim().toLocaleLowerCase(); if (seen.has(key)) repeated.add(item.name || key); else seen.add(key) }
    return [...repeated]
  }
  const duplicateCharacters = duplicates(after.characters)
  if (duplicateCharacters.length) issues.push({ code: 'DUPLICATE_CHARACTER', severity: 'WARNING', message: `角色状态重复：${duplicateCharacters.join('、')}` })
  const duplicateProps = duplicates(after.props)
  if (duplicateProps.length) issues.push({ code: 'DUPLICATE_PROP', severity: 'WARNING', message: `道具状态重复：${duplicateProps.join('、')}` })
  const open = new Set(after.openThreads.map((item) => item.toLocaleLowerCase()))
  const both = after.resolvedThreads.filter((item) => open.has(item.toLocaleLowerCase()))
  if (both.length) issues.push({ code: 'THREAD_OPEN_AND_RESOLVED', severity: 'WARNING', message: `同一伏笔同时标为未回收和已回收：${both.join('、')}` })
  if (before) {
    const inheritedOpen = new Set(before.openThreads.map((item) => item.toLocaleLowerCase()))
    const unexplained = after.resolvedThreads.filter((item) => !inheritedOpen.has(item.toLocaleLowerCase()))
    if (unexplained.length) issues.push({ code: 'RESOLVED_THREAD_NOT_INHERITED', severity: 'INFO', message: `这些回收项不在本集继承的未回收伏笔中，请确认：${unexplained.join('、')}` })
  }
  return issues
}

export function buildContinuityConstraintPayload(seriesTitle: string, sourceEpisodeNumber: number, continuity: EpisodeContinuity) {
  return {
    title: `${seriesTitle} · 第 ${sourceEpisodeNumber} 集结尾连续性`,
    body: JSON.stringify(continuity),
  }
}
