import { prisma } from '@/lib/prisma'
import { getSignedFileUrl } from '@/lib/r2'
import { ensureUserAssetsTable } from '@/lib/ensure-user-assets'

let ensured: Promise<void> | null = null

export function ensureAssetBindingsTable() {
  if (!ensured) {
    ensured = (async () => {
      await ensureUserAssetsTable()
      await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "asset_bindings" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_asset_id" TEXT,
  "asset_id" TEXT,
  "target_type" TEXT NOT NULL,
  "target_key" TEXT NOT NULL,
  "reference_role" TEXT NOT NULL DEFAULT 'GENERAL',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_bindings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "asset_bindings_user_asset_id_fkey" FOREIGN KEY ("user_asset_id") REFERENCES "user_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "asset_bindings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE
)
`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "asset_bindings_project_target_enabled_idx" ON "asset_bindings"("project_id", "target_type", "target_key", "enabled")`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "asset_bindings_user_asset_id_idx" ON "asset_bindings"("user_asset_id")`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "asset_bindings_asset_id_idx" ON "asset_bindings"("asset_id")`)
    })()
  }
  return ensured
}

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
  await ensureAssetBindingsTable()
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
