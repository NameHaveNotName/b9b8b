/**
 * 迁移遗漏文件到 R2
 * 用法:
 *   npx ts-node scripts/migrate-missing-to-r2.ts       # dry-run
 *   npx ts-node scripts/migrate-missing-to-r2.ts --yes # 执行
 */
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

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

const MISSING_FILES = [
  'projects/cmrt57exj000004l4scoqh4y1/characters/char_001.png',
  'projects/cmrt57exj000004l4scoqh4y1/characters/char_002.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_001.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_002.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_003.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_004.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_005.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_006.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_007.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_008.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_009.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_010.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_011.png',
  'projects/cmrt57exj000004l4scoqh4y1/storyboard/shot_012.png',
  'projects/cmruukm8h000304jr7svj33u4/bgm_1785482338616.mp3',
]

async function migrateFile(key: string): Promise<boolean> {
  try {
    const getCmd = new GetObjectCommand({ Bucket: SUPABASE_BUCKET, Key: key })
    const response = await supabaseClient.send(getCmd)
    const chunks: Uint8Array[] = []
    if (response.Body) {
      for await (const chunk of response.Body as any) {
        chunks.push(chunk)
      }
    }
    const buffer = Buffer.concat(chunks)
    const contentType = response.ContentType || (key.endsWith('.mp3') ? 'audio/mpeg' : 'image/png')
    console.log('  [DOWNLOAD] ' + key + ' (' + (buffer.length / 1024).toFixed(1) + ' KB)')

    const putCmd = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
    await r2Client.send(putCmd)
    console.log('  [UPLOAD]   ' + key)
    return true
  } catch (err: any) {
    console.error('  [FAILED]   ' + key + ': ' + err.message)
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = !args.includes('--yes')

  console.log('='.repeat(60))
  console.log('迁移遗漏文件到 R2')
  console.log('='.repeat(60))
  console.log('模式: ' + (dryRun ? '预览（不执行）' : '执行迁移'))
  console.log('文件数: ' + MISSING_FILES.length)
  console.log('='.repeat(60))

  if (dryRun) {
    console.log('\n[预览] 以下文件将迁移到 R2:')
    for (const f of MISSING_FILES) {
      console.log('  ' + f)
    }
    console.log('\n添加 --yes 参数执行迁移')
    return
  }

  console.log('\n开始迁移...')
  let success = 0
  let failed = 0
  for (const file of MISSING_FILES) {
    const ok = await migrateFile(file)
    if (ok) success++
    else failed++
  }

  console.log('\n' + '='.repeat(60))
  console.log('迁移完成: 成功=' + success + ', 失败=' + failed)
  console.log('='.repeat(60))
}

main().catch(console.error)
