export interface RecoverableReferenceAsset {
  index: number
  url: string
  label: string
  roles: string[]
  suspected: boolean
  replaced: boolean
}

const REFERENCE_REJECTION = /(?:real\s*(?:person|face)|human\s*face|portrait|facial|identity|真人|人脸|肖像|面部|参考图|reference\s*image).*(?:reject|block|moderation|policy|审核|拒绝|违规)|(?:reject|block|moderation|policy|审核|拒绝|违规).*(?:real\s*(?:person|face)|human\s*face|portrait|facial|identity|真人|人脸|肖像|面部|参考图|reference\s*image)/i

export function isReferenceModerationFailure(errorMessage: unknown): boolean {
  return typeof errorMessage === 'string' && REFERENCE_REJECTION.test(errorMessage)
}

export function listRecoverableReferences(referenceAssets: unknown, errorMessage: unknown): RecoverableReferenceAsset[] {
  if (!isReferenceModerationFailure(errorMessage)) return []
  const images = Array.isArray((referenceAssets as any)?.images) ? (referenceAssets as any).images : []
  return images.flatMap((image: any, position: number) => {
    const url = typeof image?.url === 'string' ? image.url.trim() : ''
    if (!url) return []
    const roles = Array.isArray(image.roles)
      ? image.roles.filter((role: unknown) => typeof role === 'string')
      : typeof image.role === 'string' ? [image.role] : []
    const suspected = roles.some((role: string) => ['identity', 'start_state', 'continuity'].includes(role))
    return [{
      index: Number.isInteger(image.index) ? image.index : position + 1,
      url,
      label: typeof image.label === 'string'
        ? image.label
        : Array.isArray(image.labels) && image.labels[0] ? String(image.labels[0]) : `参考图 ${position + 1}`,
      roles,
      suspected,
      replaced: typeof image?.replacementAssetId === 'string',
    }]
  })
}

export function replaceReferenceAssetUrl(referenceAssets: unknown, args: {
  index: number
  expectedUrl: string
  replacementUrl: string
  replacementAssetId: string
  errorMessage: string
}): Record<string, unknown> {
  const current = referenceAssets && typeof referenceAssets === 'object' ? referenceAssets as any : {}
  const images = Array.isArray(current.images) ? current.images : []
  let replaced = false
  const nextImages = images.map((image: any, position: number) => {
    const index = Number.isInteger(image?.index) ? image.index : position + 1
    if (index !== args.index || image?.url !== args.expectedUrl) return image
    replaced = true
    return { ...image, url: args.replacementUrl, replacementAssetId: args.replacementAssetId }
  })
  if (!replaced) throw new Error('REFERENCE_RECOVERY_STALE')
  return {
    ...current,
    images: nextImages,
    recoveryHistory: [
      ...(Array.isArray(current.recoveryHistory) ? current.recoveryHistory : []),
      {
        referenceIndex: args.index,
        originalUrl: args.expectedUrl,
        replacementUrl: args.replacementUrl,
        replacementAssetId: args.replacementAssetId,
        supplierError: args.errorMessage.slice(0, 500),
        confirmedAt: new Date().toISOString(),
      },
    ],
  }
}
