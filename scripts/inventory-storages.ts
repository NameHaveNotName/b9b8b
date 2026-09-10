/**
 * 只读调查脚本：列出 Supabase Storage 和 R2 的文件
 */
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const SUPABASE_S3_ENDPOINT = requireEnv('SUPABASE_STORAGE_S3_ENDPOINT')
const SUPABASE_ACCESS_KEY_ID = requireEnv('SUPABASE_STORAGE_S3_ACCESS_KEY_ID')
const SUPABASE_SECRET_ACCESS_KEY = requireEnv('SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY')
const SUPABASE_BUCKET = requireEnv('SUPABASE_STORAGE_BUCKET')
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID')
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY')
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME')
const R2_ENDPOINT = requireEnv('R2_ENDPOINT')

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

interface FileInfo {
  key: string
  size: number
  lastModified: Date
}

async function listFiles(client: S3Client, bucket: string, label: string): Promise<{ files: FileInfo[]; totalSize: number; count: number }> {
  const files: FileInfo[] = []
  let continuationToken: string | undefined
  let totalSize = 0

  console.log('\n' + '='.repeat(60))
  console.log(label + ' - Bucket: ' + bucket)
  console.log('='.repeat(60))

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    })
    const response = await client.send(command)

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.Size !== undefined) {
          files.push({
            key: obj.Key,
            size: obj.Size,
            lastModified: obj.LastModified || new Date(),
          })
          totalSize += obj.Size
        }
      }
    }
    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  const totalSizeMB = totalSize / (1024 * 1024)
  console.log('\n总计: ' + files.length + ' 个文件, ' + totalSizeMB.toFixed(2) + ' MB\n')

  // 按前缀分组统计
  const prefixMap: Record<string, number> = {}
  for (const f of files) {
    const parts = f.key.split('/')
    const prefix = parts.slice(0, 2).join('/')
    prefixMap[prefix] = (prefixMap[prefix] || 0) + 1
  }

  console.log('按前缀分组:')
  const sortedPrefixes = Object.entries(prefixMap).sort((a, b) => b[1] - a[1])
  for (const [prefix, count] of sortedPrefixes) {
    console.log('  ' + prefix + ': ' + count + ' 个文件')
  }

  // 列出前 20 个文件
  console.log('\n前 20 个文件:')
  for (let i = 0; i < Math.min(20, files.length); i++) {
    const f = files[i]
    console.log('  ' + f.key + ' (' + (f.size / 1024).toFixed(1) + ' KB) - ' + f.lastModified.toISOString().split('T')[0])
  }

  if (files.length > 20) {
    console.log('  ... 还有 ' + (files.length - 20) + ' 个文件')
  }

  return { files, totalSize, count: files.length }
}

async function main() {
  console.log('开始调查存储桶...\n')

  const supabaseResult = await listFiles(supabaseClient, SUPABASE_BUCKET, 'Supabase Storage (filmflow)')
  const r2Result = await listFiles(r2Client, R2_BUCKET_NAME, 'Cloudflare R2 (ai-film-assets)')

  console.log('\n' + '='.repeat(60))
  console.log('汇总')
  console.log('='.repeat(60))
  console.log('Supabase Storage: ' + supabaseResult.count + ' 个文件, ' + (supabaseResult.totalSize / (1024 * 1024)).toFixed(2) + ' MB')
  console.log('R2: ' + r2Result.count + ' 个文件, ' + (r2Result.totalSize / (1024 * 1024)).toFixed(2) + ' MB')

  // 检查 R2 和 Supabase 的文件重叠情况
  const supabaseKeys: Record<string, boolean> = {}
  for (const f of supabaseResult.files) supabaseKeys[f.key] = true

  const r2Keys: Record<string, boolean> = {}
  for (const f of r2Result.files) r2Keys[f.key] = true

  const inBoth: string[] = []
  const onlySupabase: string[] = []
  for (const k of Object.keys(supabaseKeys)) {
    if (r2Keys[k]) inBoth.push(k)
    else onlySupabase.push(k)
  }
  const onlyR2: string[] = []
  for (const k of Object.keys(r2Keys)) {
    if (!supabaseKeys[k]) onlyR2.push(k)
  }

  console.log('\n文件重叠分析:')
  console.log('  两边都有: ' + inBoth.length + ' 个')
  console.log('  仅在 Supabase: ' + onlySupabase.length + ' 个')
  console.log('  仅在 R2: ' + onlyR2.length + ' 个')

  if (onlySupabase.length > 0 && onlySupabase.length <= 20) {
    console.log('\n仅在 Supabase 的文件:')
    for (const k of onlySupabase) {
      const f = supabaseResult.files.find(x => x.key === k)!
      console.log('  ' + k + ' (' + (f.size / 1024).toFixed(1) + ' KB)')
    }
  } else if (onlySupabase.length > 0) {
    console.log('\n仅在 Supabase 的文件 (前 10):')
    for (let i = 0; i < Math.min(10, onlySupabase.length); i++) {
      const k = onlySupabase[i]
      const f = supabaseResult.files.find(x => x.key === k)!
      console.log('  ' + k + ' (' + (f.size / 1024).toFixed(1) + ' KB)')
    }
    console.log('  ... 还有 ' + (onlySupabase.length - 10) + ' 个')
  }
}

main().catch(console.error)
