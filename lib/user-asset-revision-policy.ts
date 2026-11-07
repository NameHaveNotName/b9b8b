export function resolveUserAssetRevisionMedia(
  source: { currentRevisionId?: string | null; storageKey?: string | null; mimeType?: string | null },
  revision: { id: string; storageKey?: string | null; mimeType?: string | null; attachments?: Array<{ role: string; storageKey: string; mimeType: string }> },
) {
  const primary = revision.attachments?.find((attachment) => attachment.role === 'PRIMARY') || revision.attachments?.[0]
  const mayUseTopLevelCurrent = source.currentRevisionId === revision.id
  return {
    sourceKey: revision.storageKey || primary?.storageKey || (mayUseTopLevelCurrent ? source.storageKey : null),
    mimeType: revision.mimeType || primary?.mimeType || (mayUseTopLevelCurrent ? source.mimeType : null),
  }
}
