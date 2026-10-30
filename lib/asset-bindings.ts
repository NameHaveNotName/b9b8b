import { prisma } from '@/lib/prisma'
import { getSignedFileUrl } from '@/lib/r2'

export async function resolveBindingUrl(binding: any): Promise<string> {
  const userAsset = Array.isArray(binding.userAsset) ? binding.userAsset[0] : binding.userAsset
  const asset = Array.isArray(binding.asset) ? binding.asset[0] : binding.asset
  const source = userAsset || asset
  if (!source) return ''
  if (source.storageKey && !String(source.storageKey).startsWith('user-asset:')) {
    try { return await getSignedFileUrl(source.storageKey, 3600) } catch {}
  }
  return source.url || ''
}

export async function getBoundReferences(projectId: string, targetType: string, targetKey: string) {
  const bindings = await prisma.assetBinding.findMany({
    where: { projectId, targetType, targetKey, enabled: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    include: { userAsset: true, asset: true },
  })
  return Promise.all(bindings.map(async (binding: any) => {
    const userAsset = Array.isArray(binding.userAsset) ? binding.userAsset[0] : binding.userAsset
    const asset = Array.isArray(binding.asset) ? binding.asset[0] : binding.asset
    return {
    id: binding.id,
    url: await resolveBindingUrl(binding),
    priority: binding.priority,
    referenceRole: binding.referenceRole,
    userAssetId: binding.userAssetId,
    assetId: binding.assetId,
    title: userAsset?.title || (asset?.metadata as any)?.title || '优先素材',
  }}))
}
