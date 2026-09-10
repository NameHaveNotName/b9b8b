/**
 * 检查 R2 中特定项目的文件列表
 */
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const R2_ENDPOINT = requireEnv('R2_ENDPOINT')
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID')
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY')
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME')

const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
})

async function listR2Files(prefix: string) {
  const cmd = new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: prefix })
  const r = await r2Client.send(cmd)
  return (r.Contents || []).sort((a: any, b: any) => a.Key.localeCompare(b.Key))
}

async function main() {
  // 检查 cmrt57exj 项目
  console.log('R2 files for cmrt57exj:')
  const files1 = await listR2Files('projects/cmrt57exj')
  console.log('Count: ' + files1.length)
  for (const o of files1) {
    console.log('  ' + o.Key + ' (' + ((o.Size || 0) / 1024).toFixed(1) + ' KB)')
  }

  console.log('\nR2 files for cmruukm8h:')
  const files2 = await listR2Files('projects/cmruukm8h')
  console.log('Count: ' + files2.length)
  for (const o of files2) {
    console.log('  ' + o.Key + ' (' + ((o.Size || 0) / 1024).toFixed(1) + ' KB)')
  }
}

main().catch(console.error)
