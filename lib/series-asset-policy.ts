export const MAX_SERIES_ASSETS = 50

export type SeriesAssetKind = 'CHARACTER' | 'ENVIRONMENT' | 'STYLE' | 'OBJECT' | 'BRAND' | 'STORY' | 'TEXT' | 'REFERENCE'

export function seriesReferenceRole(kind: SeriesAssetKind) {
  if (kind === 'CHARACTER') return 'IDENTITY'
  if (kind === 'ENVIRONMENT') return 'ENVIRONMENT'
  if (kind === 'STYLE') return 'STYLE'
  if (kind === 'BRAND' || kind === 'OBJECT') return 'PRODUCT'
  return 'GENERAL'
}

export function isStructuredSeriesAsset(contentType: string, payload: unknown) {
  return !['IMAGE', 'VIDEO', 'AUDIO'].includes(contentType) && Boolean(payload && typeof payload === 'object')
}
