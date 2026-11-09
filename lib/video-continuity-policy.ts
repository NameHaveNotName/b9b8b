import { evidenceDispositionCanEnterTimeline } from './video-evidence.ts'

export type ContinuityEvidenceLike = {
  id?: string | null
  disposition?: unknown
  reviewedAt?: unknown
  usableStartMs?: unknown
  usableEndMs?: unknown
  continuityReferenceStatus?: unknown
  continuityAnchorStorageKey?: unknown
  continuityAnchorTimeMs?: unknown
}

export type ContinuityReferenceAsset = {
  url: string
  storageKey: string
  label: string
  roles: string[]
  authority: string
  exclude: string[]
  sourceEvidencePackageId: string
  anchorTimeMs: number
  propagationEligibility: 'ELIGIBLE'
}

function finite(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

export function continuityPropagationIssue(evidence: ContinuityEvidenceLike | null | undefined): string | null {
  if (!evidence?.reviewedAt) return '素材尚未完成人工审片'
  if (!evidenceDispositionCanEnterTimeline(evidence.disposition)) return '素材未获准进入成片'
  if (evidence.continuityReferenceStatus !== 'ELIGIBLE') return '未获准作为下游连续性参考'
  if (typeof evidence.continuityAnchorStorageKey !== 'string' || !evidence.continuityAnchorStorageKey.trim()) {
    return '缺少独立连续性锚点'
  }
  const anchor = finite(evidence.continuityAnchorTimeMs)
  const start = finite(evidence.usableStartMs)
  const end = finite(evidence.usableEndMs)
  if (anchor == null || start == null || end == null || anchor < start || anchor > end) {
    return '连续性锚点不在已验收可用区间内'
  }
  return null
}

export function continuityReferenceCanPropagate(evidence: ContinuityEvidenceLike | null | undefined): boolean {
  return continuityPropagationIssue(evidence) === null
}

function existingImages(referenceAssets: unknown): any[] {
  return Array.isArray((referenceAssets as any)?.images) ? (referenceAssets as any).images : []
}

export function removeContinuityReferenceAsset(referenceAssets: unknown, evidencePackageId: string): any {
  const current = referenceAssets && typeof referenceAssets === 'object' ? referenceAssets as any : {}
  const images = existingImages(current)
    .filter((image) => image?.sourceEvidencePackageId !== evidencePackageId)
    .map((image, index) => ({ ...image, index: index + 1 }))
  return { ...current, images }
}

export function mergeContinuityReferenceAsset(
  referenceAssets: unknown,
  asset: ContinuityReferenceAsset
): any {
  const withoutOld = removeContinuityReferenceAsset(referenceAssets, asset.sourceEvidencePackageId)
  const images = [...existingImages(withoutOld), asset]
    .map((image, index) => ({ ...image, index: index + 1 }))
  return { ...withoutOld, images }
}
