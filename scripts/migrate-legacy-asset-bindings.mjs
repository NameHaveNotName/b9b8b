import { CopyObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString?.startsWith('postgresql://')) throw new Error('DIRECT_URL or DATABASE_URL must be PostgreSQL')

const r2Mode = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME)
const supabaseMode = Boolean(process.env.SUPABASE_STORAGE_S3_ENDPOINT && process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID && process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY && process.env.SUPABASE_STORAGE_BUCKET)
const storage = r2Mode ? {
  client: new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } }),
  bucket: process.env.R2_BUCKET_NAME,
} : supabaseMode ? {
  client: new S3Client({ region: 'ap-southeast-2', endpoint: process.env.SUPABASE_STORAGE_S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY } }),
  bucket: process.env.SUPABASE_STORAGE_BUCKET,
} : null

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const encodeCopySource = (bucket, key) => `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`

try {
  const legacyBindings = await prisma.assetBinding.findMany({
    where: { userAssetId: { not: null }, assetId: null },
    include: { userAsset: { include: { revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } } } },
    orderBy: { createdAt: 'asc' },
  })
  if (legacyBindings.length === 0) {
    console.log('legacy asset binding migration: nothing to migrate')
    process.exitCode = 0
  } else {
    if (!storage) throw new Error(`Found ${legacyBindings.length} legacy bindings but storage credentials are missing`)
    let migrated = 0
    for (const binding of legacyBindings) {
      const source = binding.userAsset
      if (!source) throw new Error(`Legacy binding ${binding.id} references a missing personal asset`)
      const revision = source.currentRevisionId
        ? await prisma.userAssetRevision.findFirst({ where: { id: source.currentRevisionId, userAssetId: source.id } })
        : source.revisions[0]
      if (!revision) throw new Error(`Personal asset ${source.id} has no revision`)

      let projectAsset = await prisma.asset.findFirst({ where: { projectId: binding.projectId, sourceUserAssetRevisionId: revision.id } })
      if (!projectAsset) {
        const extension = source.storageKey.includes('.') ? `.${source.storageKey.split('.').pop()}` : '.bin'
        const destinationKey = `projects/${binding.projectId}/library-snapshots/${source.id}/${revision.id}${extension}`
        await storage.client.send(new CopyObjectCommand({ Bucket: storage.bucket, CopySource: encodeCopySource(storage.bucket, revision.storageKey || source.storageKey), Key: destinationKey, ContentType: revision.mimeType || source.mimeType, MetadataDirective: 'COPY' }))
        projectAsset = await prisma.asset.create({
          data: {
            projectId: binding.projectId, createdById: binding.createdById, type: 'REFERENCE',
            contentType: revision.contentType, mimeType: revision.mimeType || source.mimeType,
            storageKey: destinationKey, url: `storage://${destinationKey}`,
            schemaVersion: revision.schemaVersion, structuredPayload: revision.structuredPayload ?? undefined,
            sourceUserAssetId: source.id, sourceUserAssetRevisionId: revision.id, contentHash: revision.contentHash,
            origin: 'LIBRARY_SNAPSHOT', metadata: { source: 'legacy-user-asset-binding-migration', sourceUserAssetId: source.id, sourceUserAssetRevisionId: revision.id, migratedAt: new Date().toISOString() },
          },
        })
      }
      await prisma.assetBinding.update({ where: { id: binding.id }, data: { assetId: projectAsset.id, userAssetId: null } })
      migrated += 1
    }
    console.log(`legacy asset binding migration: migrated ${migrated} binding(s)`)
  }
} finally {
  await prisma.$disconnect()
}
