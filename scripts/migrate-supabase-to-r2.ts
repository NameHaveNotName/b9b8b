/**
 * Supabase Storage 到 R2 迁移脚本
 *
 * 使用方法：
 *   npx ts-node scripts/migrate-supabase-to-r2.ts          # 预览模式
 *   npx ts-node scripts/migrate-supabase-to-r2.ts --yes   # 执行迁移
 */

import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// ============ 配置 ============

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

// 保留最近多少天的文件
const KEEP_DAYS = 7

// ============ 客户端初始化 ============

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

// ============ 主逻辑 ============

interface MigrationStats {
  total: number
  toMigrate: number
  toDelete: number
  migrated: number
  deleted: number
  errors: number
}

async function listSupabaseFiles(prefix: string = ''): Promise<{ key: string; lastModified: Date; size: number }[]> {
  const files: { key: string; lastModified: Date; size: number }[] = []
  let continuationToken: string | undefined

  do {
    const command = new ListObjectsV2Command({
      Bucket: SUPABASE_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    })

    const response = await supabaseClient.send(command)

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.LastModified && obj.Size !== undefined) {
          files.push({
            key: obj.Key,
            lastModified: obj.LastModified,
            size: obj.Size,
          })
        }
      }
    }

    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  return files
}

async function downloadFile(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: SUPABASE_BUCKET,
    Key: key,
  })

  const response = await supabaseClient.send(command)
  const chunks: Uint8Array[] = []

  if (response.Body) {
    for await (const chunk of response.Body as any) {
      chunks.push(chunk)
    }
  }

  return Buffer.concat(chunks)
}

async function uploadToR2(key: string, body: Buffer, contentType: string = 'image/png'): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  })

  await r2Client.send(command)
}

async function deleteFromSupabase(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: SUPABASE_BUCKET,
    Key: key,
  })

  await supabaseClient.send(command)
}

function getContentType(key: string): string {
  const ext = key.toLowerCase().split('.').pop()
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
  }
  return types[ext || ''] || 'application/octet-stream'
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = !args.includes('--yes')

  console.log('='.repeat(60))
  console.log('Supabase Storage → R2 迁移工具')
  console.log('='.repeat(60))
  console.log(`模式: ${dryRun ? '预览（不执行）' : '执行迁移'}`)
  console.log(`保留最近 ${KEEP_DAYS} 天的文件`)
  console.log('='.repeat(60))

  if (dryRun) {
    console.log('\n[预览模式] 实际不会执行任何操作')
    console.log('添加 --yes 参数执行迁移\n')
  }

  const stats: MigrationStats = {
    total: 0,
    toMigrate: 0,
    toDelete: 0,
    migrated: 0,
    deleted: 0,
    errors: 0,
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - KEEP_DAYS)
  console.log(`\n截止日期: ${cutoffDate.toISOString()}`)

  try {
    console.log('\n正在扫描 Supabase Storage 文件...')
    const files = await listSupabaseFiles()

    stats.total = files.length
    console.log(`找到 ${files.length} 个文件\n`)

    const toMigrate: { key: string; lastModified: Date; size: number }[] = []
    const toDelete: { key: string; lastModified: Date; size: number }[] = []

    for (const file of files) {
      if (file.lastModified > cutoffDate) {
        toMigrate.push(file)
      } else {
        toDelete.push(file)
      }
    }

    stats.toMigrate = toMigrate.length
    stats.toDelete = toDelete.length

    const migrateSizeMB = toMigrate.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)
    const deleteSizeMB = toDelete.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)

    console.log('文件统计:')
    console.log(`  总文件数: ${stats.total}`)
    console.log(`  待迁移 (${KEEP_DAYS}天内): ${stats.toMigrate} 个 (${migrateSizeMB.toFixed(2)} MB)`)
    console.log(`  待删除 (${KEEP_DAYS}天外): ${stats.toDelete} 个 (${deleteSizeMB.toFixed(2)} MB)`)

    if (dryRun) {
      console.log('\n[预览] 待迁移文件:')
      for (const file of toMigrate.slice(0, 10)) {
        console.log(`  ${file.key} (${(file.size / 1024).toFixed(1)} KB) - ${file.lastModified.toISOString()}`)
      }
      if (toMigrate.length > 10) {
        console.log(`  ... 还有 ${toMigrate.length - 10} 个文件`)
      }

      console.log('\n[预览] 待删除文件:')
      for (const file of toDelete.slice(0, 10)) {
        console.log(`  ${file.key} (${(file.size / 1024).toFixed(1)} KB) - ${file.lastModified.toISOString()}`)
      }
      if (toDelete.length > 10) {
        console.log(`  ... 还有 ${toDelete.length - 10} 个文件`)
      }
    }

    if (!dryRun) {
      console.log('\n开始迁移文件到 R2...')

      for (let i = 0; i < toMigrate.length; i++) {
        const file = toMigrate[i]
        try {
          console.log(`[${i + 1}/${toMigrate.length}] 迁移: ${file.key}`)
          const buffer = await downloadFile(file.key)
          const contentType = getContentType(file.key)
          await uploadToR2(file.key, buffer, contentType)
          stats.migrated++
        } catch (err: any) {
          console.error(`  迁移失败: ${err.message}`)
          stats.errors++
        }

        if ((i + 1) % 10 === 0) {
          console.log(`  进度: ${i + 1}/${toMigrate.length}`)
        }
      }

      console.log('\n开始删除旧文件...')

      for (let i = 0; i < toDelete.length; i++) {
        const file = toDelete[i]
        try {
          console.log(`[${i + 1}/${toDelete.length}] 删除: ${file.key}`)
          await deleteFromSupabase(file.key)
          stats.deleted++
        } catch (err: any) {
          console.error(`  删除失败: ${err.message}`)
          stats.errors++
        }

        if ((i + 1) % 10 === 0) {
          console.log(`  进度: ${i + 1}/${toDelete.length}`)
        }
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('迁移完成')
    console.log('='.repeat(60))
    console.log(`总文件数: ${stats.total}`)
    console.log(`待迁移: ${stats.toMigrate}`)
    console.log(`待删除: ${stats.toDelete}`)
    console.log(`已迁移: ${stats.migrated}`)
    console.log(`已删除: ${stats.deleted}`)
    console.log(`错误数: ${stats.errors}`)

    if (dryRun) {
      console.log('\n[预览模式] 如需执行迁移，请重新运行并添加 --yes 参数')
    }

  } catch (error) {
    console.error('\n迁移失败:', error)
    process.exit(1)
  }
}

main()
