import { createHash } from 'node:crypto'

export type EpisodeDetachmentState = {
  episodeId: string
  updatedAt: string | Date
  bibleRevisionId: string
  projectId: string
  snapshotAssetIds: string[]
  constraintIds: string[]
}

export function episodeDetachmentFingerprint(input: EpisodeDetachmentState) {
  return createHash('sha256').update(JSON.stringify({
    episodeId: input.episodeId,
    updatedAt: new Date(input.updatedAt).toISOString(),
    bibleRevisionId: input.bibleRevisionId,
    projectId: input.projectId,
    snapshotAssetIds: [...input.snapshotAssetIds].sort(),
    constraintIds: [...input.constraintIds].sort(),
  })).digest('hex')
}

export function isSeriesSnapshotOrigin(origin: string) {
  return origin === 'SERIES_BIBLE_SNAPSHOT' || origin === 'SERIES_CONTINUITY_SNAPSHOT' || origin === 'SERIES_ASSET_SNAPSHOT'
}
