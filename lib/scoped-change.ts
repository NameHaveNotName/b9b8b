import { createHash } from 'node:crypto'

export type ScopedChangeStepType = 'IDEATION' | 'FRAMEWORK' | 'STORYBOARD'
export type ScopedChangeScopeType = 'DIRECTION' | 'SECTION' | 'ACT' | 'CHARACTER' | 'SHOT' | 'FRAMEWORK_FIELD'

export interface ScopedChangeOperation {
  field: string
  before: unknown
  after: unknown
  reason?: string
}

export interface ResolvedChangeScope {
  stepType: ScopedChangeStepType
  scopeType: ScopedChangeScopeType
  scopeKey: string
  label: string
  snapshot: Record<string, unknown>
  allowedFields: string[]
  baseHash: string
}

const ALLOWED_FIELDS: Record<ScopedChangeScopeType, readonly string[]> = {
  DIRECTION: ['title', 'description', 'keywords'],
  SECTION: ['value'],
  ACT: ['title', 'content', 'estimatedDuration', 'estimatedShots', 'pacing', 'keyScenes'],
  CHARACTER: ['name', 'role', 'description'],
  SHOT: [
    'description', 'cameraMove', 'duration', 'sceneName', 'characters',
    'generationUnitId', 'generationUnitIntent', 'actionChainId', 'continuityGroupId',
    'continuityFromPrevious', 'startsNewGenerationUnit', 'unitBoundaryReason',
  ],
  FRAMEWORK_FIELD: ['value'],
}

const SECTION_FIELDS = new Set(['inspiration', 'styleGuide', 'background', 'synopsis', 'overallPacing'])

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export function scopedChangeHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function safeClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeActNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function snapshotFields(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, safeClone(source[field] ?? null)]))
}

function finalizeScope(input: Omit<ResolvedChangeScope, 'baseHash'>): ResolvedChangeScope {
  return { ...input, baseHash: scopedChangeHash(input.snapshot) }
}

const FRAMEWORK_TOP_LEVEL_TEXT_FIELDS = new Set([
  'inspiration', 'background', 'visualStyle', 'styleGuide', 'synopsis',
  'overallPacing', 'storyLength', 'totalDuration',
])
const FRAMEWORK_CHARACTER_TEXT_FIELDS = new Set(['name', 'role', 'description'])
const FRAMEWORK_CHARACTER_DEEPENED_FIELDS = new Set(['appearance', 'personality', 'catchphrase', 'memoryPoints'])

function parseFrameworkFieldPointer(scopeKey: string): string[] {
  if (!scopeKey.startsWith('/') || scopeKey.length > 240) throw new Error('SCOPED_CHANGE_FIELD_PATH_INVALID')
  const segments = scopeKey.slice(1).split('/').map(segment => decodeURIComponent(segment))
  if (segments.some(segment => !segment || ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    throw new Error('SCOPED_CHANGE_FIELD_PATH_INVALID')
  }
  const isIndex = (value: string) => /^\d{1,4}$/.test(value)
  const allowed =
    (segments.length === 1 && FRAMEWORK_TOP_LEVEL_TEXT_FIELDS.has(segments[0])) ||
    (segments.length === 3 && segments[0] === 'characters' && isIndex(segments[1]) && FRAMEWORK_CHARACTER_TEXT_FIELDS.has(segments[2])) ||
    (segments.length === 4 && segments[0] === 'characters' && isIndex(segments[1]) && segments[2] === 'deepened' && FRAMEWORK_CHARACTER_DEEPENED_FIELDS.has(segments[3])) ||
    (segments.length === 5 && segments[0] === 'characters' && isIndex(segments[1]) && segments[2] === 'deepened' && segments[3] === 'attitudes') ||
    (segments.length === 3 && segments[0] === 'acts' && isIndex(segments[1]) && ['title', 'content', 'estimatedDuration', 'pacing'].includes(segments[2])) ||
    (segments.length === 4 && segments[0] === 'acts' && isIndex(segments[1]) && segments[2] === 'keyScenes' && isIndex(segments[3])) ||
    (segments.length === 2 && segments[0] === 'environments' && isIndex(segments[1]))
  if (!allowed) throw new Error('SCOPED_CHANGE_FIELD_PATH_FORBIDDEN')
  return segments
}

function resolvePointerParent(output: Record<string, any>, segments: string[]): { parent: Record<string, any> | any[]; key: string; value: unknown } {
  let current: any = output
  for (const segment of segments.slice(0, -1)) {
    if (current == null || typeof current !== 'object' || !(segment in current)) throw new Error('SCOPED_CHANGE_TARGET_NOT_FOUND')
    current = current[segment]
  }
  const key = segments[segments.length - 1]
  if (current == null || typeof current !== 'object' || !(key in current)) throw new Error('SCOPED_CHANGE_TARGET_NOT_FOUND')
  const value = current[key]
  if (typeof value !== 'string') throw new Error('SCOPED_CHANGE_FIELD_NOT_TEXT')
  return { parent: current, key, value }
}

export function resolveScopedChangeScope(input: {
  stepType: string
  outputData: unknown
  scopeType: string
  scopeKey: string
}): ResolvedChangeScope {
  const { stepType, scopeType, scopeKey } = input
  if (!['IDEATION', 'FRAMEWORK', 'STORYBOARD'].includes(stepType)) throw new Error('SCOPED_CHANGE_STEP_UNSUPPORTED')
  if (!Object.hasOwn(ALLOWED_FIELDS, scopeType)) throw new Error('SCOPED_CHANGE_SCOPE_UNSUPPORTED')
  const output = (input.outputData && typeof input.outputData === 'object' ? input.outputData : {}) as Record<string, any>

  if (stepType === 'IDEATION' && scopeType === 'DIRECTION') {
    const match = /^direction:(\d+)$/.exec(scopeKey)
    const index = match ? Number(match[1]) : -1
    const direction = Array.isArray(output.directions) ? output.directions[index] : null
    if (!direction || typeof direction !== 'object') throw new Error('SCOPED_CHANGE_TARGET_NOT_FOUND')
    const allowedFields = [...ALLOWED_FIELDS.DIRECTION]
    return finalizeScope({ stepType, scopeType, scopeKey, label: `创意方向 ${index + 1}`, allowedFields, snapshot: snapshotFields(direction, allowedFields) })
  }

  if (stepType === 'FRAMEWORK' && scopeType === 'SECTION') {
    if (!SECTION_FIELDS.has(scopeKey)) throw new Error('SCOPED_CHANGE_SECTION_FORBIDDEN')
    const snapshot = { value: safeClone(output[scopeKey] ?? '') }
    return finalizeScope({ stepType, scopeType, scopeKey, label: `框架 · ${scopeKey}`, allowedFields: ['value'], snapshot })
  }

  if (stepType === 'FRAMEWORK' && scopeType === 'ACT') {
    const match = /^act:(\d+)$/.exec(scopeKey)
    const actNumber = match ? Number(match[1]) : -1
    const act = Array.isArray(output.acts)
      ? output.acts.find((item: any, index: number) => normalizeActNumber(item?.actNo ?? item?.actNumber ?? index + 1) === actNumber)
      : null
    if (!act) throw new Error('SCOPED_CHANGE_TARGET_NOT_FOUND')
    const allowedFields = [...ALLOWED_FIELDS.ACT]
    return finalizeScope({ stepType, scopeType, scopeKey, label: `第 ${actNumber} 幕`, allowedFields, snapshot: snapshotFields(act, allowedFields) })
  }

  if (stepType === 'FRAMEWORK' && scopeType === 'CHARACTER') {
    const characterKey = scopeKey.replace(/^character:/, '')
    const character = Array.isArray(output.characters)
      ? output.characters.find((item: any, index: number) => String(item?.id || item?.name || index) === characterKey)
      : null
    if (!character) throw new Error('SCOPED_CHANGE_TARGET_NOT_FOUND')
    const allowedFields = [...ALLOWED_FIELDS.CHARACTER]
    return finalizeScope({ stepType, scopeType, scopeKey, label: `角色 · ${character.name || characterKey}`, allowedFields, snapshot: snapshotFields(character, allowedFields) })
  }

  if (stepType === 'FRAMEWORK' && scopeType === 'FRAMEWORK_FIELD') {
    const segments = parseFrameworkFieldPointer(scopeKey)
    const { value } = resolvePointerParent(output, segments)
    const snapshot = { value: safeClone(value) }
    return finalizeScope({ stepType, scopeType, scopeKey, label: `框架文字 · ${scopeKey}`, allowedFields: ['value'], snapshot })
  }

  if (stepType === 'STORYBOARD' && scopeType === 'SHOT') {
    const match = /^act:(\d+)\/shot:(.+)$/.exec(scopeKey)
    const actNumber = match ? Number(match[1]) : -1
    const shotId = match?.[2] || ''
    const shot = Array.isArray(output.shots)
      ? output.shots.find((item: any) => String(item?.shotId) === shotId && normalizeActNumber(item?.actNumber) === actNumber)
      : null
    if (!shot) throw new Error('SCOPED_CHANGE_TARGET_NOT_FOUND')
    const allowedFields = [...ALLOWED_FIELDS.SHOT]
    return finalizeScope({ stepType, scopeType, scopeKey, label: `第 ${actNumber} 幕 · ${shotId}`, allowedFields, snapshot: snapshotFields(shot, allowedFields) })
  }

  throw new Error('SCOPED_CHANGE_SCOPE_STEP_MISMATCH')
}

function isAllowedValue(value: unknown): boolean {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.length <= 50 && value.every(item => isAllowedValue(item))
  return false
}

function assertOperation(operation: ScopedChangeOperation, scope: ResolvedChangeScope): void {
  if (!operation || typeof operation !== 'object') throw new Error('SCOPED_CHANGE_OPERATION_INVALID')
  if (!scope.allowedFields.includes(operation.field)) throw new Error(`SCOPED_CHANGE_FIELD_FORBIDDEN:${operation.field}`)
  if (!isAllowedValue(operation.after)) throw new Error(`SCOPED_CHANGE_VALUE_INVALID:${operation.field}`)
  if (JSON.stringify(operation.before) !== JSON.stringify(scope.snapshot[operation.field])) {
    throw new Error(`SCOPED_CHANGE_BEFORE_MISMATCH:${operation.field}`)
  }
  if (typeof operation.after === 'string' && operation.after.length > 20_000) {
    throw new Error(`SCOPED_CHANGE_VALUE_TOO_LONG:${operation.field}`)
  }
}

export function validateScopedChangeOperations(
  scope: ResolvedChangeScope,
  operations: ScopedChangeOperation[],
): ScopedChangeOperation[] {
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > scope.allowedFields.length) {
    throw new Error('SCOPED_CHANGE_OPERATIONS_COUNT_INVALID')
  }
  const seen = new Set<string>()
  for (const operation of operations) {
    assertOperation(operation, scope)
    if (seen.has(operation.field)) throw new Error(`SCOPED_CHANGE_DUPLICATE_FIELD:${operation.field}`)
    seen.add(operation.field)
  }
  return safeClone(operations)
}

function findMutableTarget(output: Record<string, any>, scope: ResolvedChangeScope): { target: Record<string, any>; sectionKey?: string } {
  if (scope.scopeType === 'DIRECTION') return { target: output.directions[Number(scope.scopeKey.split(':')[1])] }
  if (scope.scopeType === 'SECTION') return { target: output, sectionKey: scope.scopeKey }
  if (scope.scopeType === 'ACT') {
    const actNumber = Number(scope.scopeKey.split(':')[1])
    return { target: output.acts.find((item: any, index: number) => normalizeActNumber(item?.actNo ?? item?.actNumber ?? index + 1) === actNumber) }
  }
  if (scope.scopeType === 'CHARACTER') {
    const characterKey = scope.scopeKey.replace(/^character:/, '')
    return { target: output.characters.find((item: any, index: number) => String(item?.id || item?.name || index) === characterKey) }
  }
  if (scope.scopeType === 'FRAMEWORK_FIELD') {
    const { parent, key } = resolvePointerParent(output, parseFrameworkFieldPointer(scope.scopeKey))
    return { target: parent as Record<string, any>, sectionKey: key }
  }
  const match = /^act:(\d+)\/shot:(.+)$/.exec(scope.scopeKey)!
  return { target: output.shots.find((item: any) => String(item?.shotId) === match[2] && normalizeActNumber(item?.actNumber) === Number(match[1])) }
}

export function applyScopedChange(input: {
  stepType: string
  outputData: unknown
  scopeType: string
  scopeKey: string
  baseHash: string
  operations: ScopedChangeOperation[]
}): { outputData: Record<string, unknown>; scope: ResolvedChangeScope } {
  const currentScope = resolveScopedChangeScope(input)
  if (currentScope.baseHash !== input.baseHash) throw new Error('SCOPED_CHANGE_STALE')
  const operations = validateScopedChangeOperations(currentScope, input.operations)
  const output = safeClone((input.outputData || {}) as Record<string, any>)
  const { target, sectionKey } = findMutableTarget(output, currentScope)
  for (const operation of operations) {
    if (sectionKey) target[sectionKey] = safeClone(operation.after)
    else target[operation.field] = safeClone(operation.after)
  }
  return { outputData: output, scope: currentScope }
}
