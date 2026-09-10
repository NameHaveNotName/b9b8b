/**
 * 从 Supabase Storage 删除已迁移到 R2 的文件（dry-run）
 * 用法:
 *   npx ts-node scripts/cleanup-supabase-migrated.ts       # dry-run
 *   npx ts-node scripts/cleanup-supabase-migrated.ts --yes # 执行
 */
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const SUPABASE_S3_ENDPOINT = requireEnv('SUPABASE_STORAGE_S3_ENDPOINT')
const SUPABASE_ACCESS_KEY_ID = requireEnv('SUPABASE_STORAGE_S3_ACCESS_KEY_ID')
const SUPABASE_SECRET_ACCESS_KEY = requireEnv('SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY')
const SUPABASE_BUCKET = requireEnv('SUPABASE_STORAGE_BUCKET')
const R2_ENDPOINT = requireEnv('R2_ENDPOINT')
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID')
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY')
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME')

const supabaseClient = new S3Client({
  region: 'ap-southeast-2',
  endpoint: SUPABASE_S3_ENDPOINT,
  credentials: {
    accessKeyId: SUPABASE_ACCESS_KEY_ID,
    secretAccessKey: SUPABASE_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
})

async function listFiles(client: S3Client, bucket: string): Promise<string[]> {
  const files: string[] = []
  let continuationToken: string | undefined
  do {
    const command = new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
    const response = await client.send(command)
    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) files.push(obj.Key)
      }
    }
    continuationToken = response.NextContinuationToken
  } while (continuationToken)
  return files
}

async function deleteFile(client: S3Client, bucket: string, key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: bucket, Key: key })
  await client.send(command)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = !args.includes('--yes')

  console.log('='.repeat(60))
  console.log('清理 Supabase Storage 已迁移文件')
  console.log('='.repeat(60))
  console.log('模式: ' + (dryRun ? '预览（不执行）' : '执行删除'))
  console.log('')

  console.log('正在获取两边存储的文件列表...')
  const [supabaseFiles, r2Files] = await Promise.all([
    listFiles(supabaseClient, SUPABASE_BUCKET),
    listFiles(r2Client, R2_BUCKET_NAME),
  ])

  const supabaseSet = new Set(supabaseFiles)
  const r2Set = new Set(r2Files)

  // 交集：两遍都有的文件 = 已迁移完成，可以安全从 Supabase 删除
  const toDelete = supabaseFiles.filter(k => r2Set.has(k))

  console.log('Supabase 文件总数: ' + supabaseFiles.length)
  console.log('R2 文件总数: ' + r2Files.length)
  console.log('两边都有（将删除）: ' + toDelete.length)
  console.log('仅在 Supabase: ' + (supabaseFiles.length - toDelete.length))
  console.log('仅在 R2: ' + (r2Files.length - toDelete.length))
  console.log('')

  if (dryRun) {
    console.log('[预览] 将从 Supabase 删除以下文件:')
    for (const f of toDelete.slice(0, 30)) {
      console.log('  DELETE: ' + f)
    }
    if (toDelete.length > 30) {
      console.log('  ... 还有 ' + (toDelete.length - 30) + ' 个文件')
    }
    console.log('')
    console.log('添加 --yes 参数执行删除')
    return
  }

  console.log('开始删除...')
  let success = 0
  let failed = 0
  const errors: string[] = []

  for (let i = 0; i < toDelete.length; i++) {
    const key = toDelete[i]
    try {
      await deleteFile(supabaseClient, SUPABASE_BUCKET, key)
      success++
      if ((i + 1) % 50 === 0) {
        console.log('  进度: ' + (i + 1) + '/' + toDelete.length)
      }
    } catch (err: any) {
      failed++
      errors.push(key + ': ' + err.message)
      console.error('  [FAILED] ' + key + ': ' + err.message)
    }
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('删除完成: 成功=' + success + ', 失败=' + failed)
  console.log('='.repeat(60))

  if (errors.length > 0) {
    console.log('\n失败的文件:')
    for (const e of errors.slice(0, 20)) {
      console.log('  ' + e)
    }
  }
}

main().catch(console.error)
