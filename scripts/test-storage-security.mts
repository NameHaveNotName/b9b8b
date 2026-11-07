import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-film-storage-security-'))
const mockRoot = path.join(tempRoot, 'mock-storage')
const outside = path.join(tempRoot, 'outside.txt')

process.env.MOCK_STORAGE_ROOT = mockRoot
for (const name of [
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET_NAME',
  'SUPABASE_STORAGE_S3_ENDPOINT', 'SUPABASE_STORAGE_S3_ACCESS_KEY_ID',
  'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY', 'SUPABASE_STORAGE_BUCKET',
]) delete process.env[name]

try {
  await fs.writeFile(outside, 'must survive')
  const { deleteFile, downloadFile, getSignedFileUrl, uploadFile } = await import('../lib/r2.ts')
  const validKey = 'users/u1/assets/合法 image.png'
  await uploadFile(validKey, Buffer.from('safe-data'), 'image/png')
  assert.equal((await downloadFile(validKey)).toString(), 'safe-data')
  assert.equal(await getSignedFileUrl(validKey), `/mock-storage/${validKey}`)

  for (const badKey of ['../outside.txt', 'users//outside.txt', 'users\\..\\outside.txt', 'users/%2e%2e/outside.txt']) {
    await assert.rejects(uploadFile(badKey, Buffer.from('attack'), 'text/plain'))
    await assert.rejects(downloadFile(badKey))
    await assert.rejects(deleteFile(badKey))
  }
  assert.equal(await fs.readFile(outside, 'utf8'), 'must survive')

  await deleteFile(validKey)
  await assert.rejects(fs.readFile(path.join(mockRoot, ...validKey.split('/'))))
  console.log('storage security integration tests passed')
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}
