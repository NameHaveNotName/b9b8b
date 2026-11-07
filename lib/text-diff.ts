export type TextDiffSegment = { type: 'equal' | 'add' | 'remove'; text: string }

function tokenize(value: string): string[] {
  return value.match(/[\p{Script=Han}]|[A-Za-z0-9_]+|\s+|[^\s\p{Script=Han}A-Za-z0-9_]/gu) || []
}
function mergeSegments(segments: TextDiffSegment[]): TextDiffSegment[] {
  const merged: TextDiffSegment[] = []
  for (const segment of segments) {
    if (!segment.text) continue
    const previous = merged[merged.length - 1]
    if (previous?.type === segment.type) previous.text += segment.text
    else merged.push({ ...segment })
  }
  return merged
}
function prefixSuffixDiff(before: string, after: string): TextDiffSegment[] {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1
  return mergeSegments([
    { type: 'equal', text: before.slice(0, prefix) },
    { type: 'remove', text: before.slice(prefix, before.length - suffix) },
    { type: 'add', text: after.slice(prefix, after.length - suffix) },
    { type: 'equal', text: suffix ? before.slice(before.length - suffix) : '' },
  ])
}

/** Token-level LCS diff for readable Chinese/English inline highlighting. */
export function diffText(before: string, after: string): TextDiffSegment[] {
  if (before === after) return before ? [{ type: 'equal', text: before }] : []
  const left = tokenize(before)
  const right = tokenize(after)
  if (left.length * right.length > 500_000) return prefixSuffixDiff(before, after)

  const rows = left.length + 1
  const cols = right.length + 1
  const table = new Uint32Array(rows * cols)
  const at = (row: number, col: number) => row * cols + col
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      table[at(row, col)] = left[row - 1] === right[col - 1]
        ? table[at(row - 1, col - 1)] + 1
        : Math.max(table[at(row - 1, col)], table[at(row, col - 1)])
    }
  }
  const reversed: TextDiffSegment[] = []
  let row = left.length
  let col = right.length
  while (row > 0 || col > 0) {
    if (row > 0 && col > 0 && left[row - 1] === right[col - 1]) {
      reversed.push({ type: 'equal', text: left[row - 1] }); row -= 1; col -= 1
    } else if (col > 0 && (row === 0 || table[at(row, col - 1)] >= table[at(row - 1, col)])) {
      reversed.push({ type: 'add', text: right[col - 1] }); col -= 1
    } else {
      reversed.push({ type: 'remove', text: left[row - 1] }); row -= 1
    }
  }
  return mergeSegments(reversed.reverse())
}
