import path from 'node:path'

const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/
const ENCODED_SEPARATOR_RE = /%(?:2f|5c)/i

/** Object keys use POSIX-style segments in every backend. */
export function assertSafeStorageKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !key || key.includes('\0')) throw new Error('STORAGE_KEY_INVALID')
  if (key.startsWith('/') || key.startsWith('\\') || WINDOWS_ABSOLUTE_RE.test(key)) throw new Error('STORAGE_KEY_ABSOLUTE')
  if (key.includes('\\') || ENCODED_SEPARATOR_RE.test(key)) throw new Error('STORAGE_KEY_SEPARATOR')

  let decoded = key
  try {
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
  } catch {
    throw new Error('STORAGE_KEY_ENCODING')
  }

  for (const candidate of [key, decoded]) {
    if (candidate.startsWith('/') || candidate.startsWith('\\') || WINDOWS_ABSOLUTE_RE.test(candidate)) throw new Error('STORAGE_KEY_ABSOLUTE')
    if (candidate.includes('\\')) throw new Error('STORAGE_KEY_SEPARATOR')
    const segments = candidate.split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) throw new Error('STORAGE_KEY_TRAVERSAL')
  }
}
/** Resolve a validated key and then independently prove it remains below root. */
export function resolveMockStoragePath(root: string, key: string): string {
  assertSafeStorageKey(key)
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, ...key.split('/'))
  const relative = path.relative(resolvedRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('STORAGE_KEY_CONTAINMENT')
  return resolved
}
