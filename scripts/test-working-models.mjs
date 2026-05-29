// 详细测试可用模型的字段要求
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/)
  if (m) env[m[1]] = m[2]
}

const API_KEY = env.XIAOMI_API_KEY
const BASE_URL = env.XIAOMI_BASE_URL || 'https://vip.123everything.com'

async function test(label, payload) {
  console.log(`\n--- ${label} ---`)
  console.log('payload:', JSON.stringify(payload))
  const res = await fetch(`${BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  console.log(`Status: ${res.status}`)
  console.log(`Body:`, text.slice(0, 600))
}

;(async () => {
  // dall-e-3 三种 size 测试
  await test('dall-e-3 size 1024x1024', { model: 'dall-e-3', prompt: 'cinematic film still', size: '1024x1024' })
  await test('dall-e-3 size 2:3', { model: 'dall-e-3', prompt: 'cinematic film still', size: '2:3' })
  await test('dall-e-3 size 1024x1536', { model: 'dall-e-3', prompt: 'cinematic film still', size: '1024x1536' })

  // doubao-seedream-3-0 文生图
  await test('doubao-seedream-3-0-t2i 2K', { model: 'doubao-seedream-3-0-t2i-250415', prompt: 'cinematic film still', size: '2K', watermark: false })
  await test('doubao-seedream-3-0-t2i 2:3', { model: 'doubao-seedream-3-0-t2i-250415', prompt: 'cinematic film still', size: '2:3', watermark: false })

  // gpt-image-1
  await test('gpt-image-1 1024x1024', { model: 'gpt-image-1', prompt: 'cinematic film still', size: '1024x1024' })
})()
