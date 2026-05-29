// 直接测试 xiaomi-api 图像生成（用以诊断真实请求是否能通）
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 简易 .env.local 解析
const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/)
  if (m) env[m[1]] = m[2]
}

const API_KEY = env.XIAOMI_API_KEY
const BASE_URL = env.XIAOMI_BASE_URL || 'https://vip.123everything.com'

console.log('API_KEY prefix:', API_KEY?.slice(0, 12) + '...')
console.log('BASE_URL:', BASE_URL)

async function test(label, payload) {
  console.log(`\n=== ${label} ===`)
  console.log('Request body:', JSON.stringify(payload))
  try {
    const res = await fetch(`${BASE_URL}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    console.log(`Status: ${res.status} ${res.statusText}`)
    console.log(`Content-Type: ${res.headers.get('content-type')}`)
    const text = await res.text()
    console.log(`Body (first 800):`, text.slice(0, 800))
  } catch (e) {
    console.error('Network error:', e.message)
  }
}

;(async () => {
  await test('flux-kontext-pro + aspect_ratio', {
    model: 'flux-kontext-pro',
    prompt: 'cinematic film still, warm golden hour, 8k',
    n: 1,
    aspect_ratio: '2:3',
    response_format: 'url',
  })

  await test('jimeng-4.0 + size', {
    model: 'jimeng-4.0',
    prompt: 'cinematic film still, warm golden hour, 8k',
    size: '2:3',
    response_format: 'url',
  })

  await test('doubao-seedream-4-5-251128 + size 2K', {
    model: 'doubao-seedream-4-5-251128',
    prompt: 'cinematic film still, warm golden hour, 8k',
    size: '2K',
    response_format: 'url',
    watermark: false,
  })
})()
