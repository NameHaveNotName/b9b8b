// 测试更多模型变种以找出哪些可用
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
  try {
    const res = await fetch(`${BASE_URL}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    const ok = res.status === 200
    const has503 = text.includes('无可用渠道')
    const summary = ok ? 'OK' : (has503 ? '503-NO-DISTRIBUTOR' : `${res.status}`)
    console.log(`${label.padEnd(45)} | ${summary}`)
    if (!ok && !has503) console.log(`  body: ${text.slice(0,200)}`)
  } catch (e) {
    console.log(`${label.padEnd(45)} | ERROR: ${e.message}`)
  }
}

;(async () => {
  // 各种 model 变种探测
  const candidates = [
    // 豆包系列（已知可用）
    'doubao-seedream-4-5-251128',
    'doubao-seedream-3-0-t2i-250415',
    'doubao-seedream',

    // Flux 系列
    'flux-kontext-pro',
    'flux-1-pro',
    'flux-pro',
    'flux.1-pro',
    'flux.1-dev',
    'flux-dev',
    'flux',

    // 即梦系列
    'jimeng-4.0',
    'jimeng-3.0',
    'jimeng',

    // GPT Image / DALL-E
    'gpt-image-1',
    'dall-e-3',
    'dall-e-2',

    // 通义万相
    'wanx-v1',
    'wanx2.1',
    'qwen-image',

    // SD 系列
    'stable-diffusion-3.5-large',
    'sd3',
    'sdxl',
  ]

  console.log('\n=== 模型可用性扫描 ===')
  for (const m of candidates) {
    // 用最简单的 payload，根据模型类型选字段
    let payload
    if (m.includes('flux') || m.includes('dall')) {
      payload = { model: m, prompt: 'test', n: 1, aspect_ratio: '1:1' }
    } else if (m.includes('doubao') || m.includes('seedream')) {
      payload = { model: m, prompt: 'test', size: '2K', watermark: false }
    } else {
      payload = { model: m, prompt: 'test', size: '1024x1024' }
    }
    await test(m, payload)
  }
})()
