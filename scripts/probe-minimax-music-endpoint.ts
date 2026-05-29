/**
 * 2026-05-18:404 探测脚本,用于在不消耗额度的情况下确认 MiniMax 音乐 endpoint 的真实路径。
 * 只发送 1 个最小请求,通过 HTTP 404/200/4xx 判断 endpoint 是否存在。
 *
 * 运行:npx tsx scripts/probe-minimax-music-endpoint.ts --yes
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

if (!API_KEY) {
  console.error('❌ XIAOMI_API_KEY 未配置')
  process.exit(1)
}

const _confirmed = process.argv.includes('--yes') || process.env.MINIMAX_PROBE_CONFIRM === '1'
if (!_confirmed) {
  console.error('⚠️ 加 --yes 才会发请求(每个 endpoint 都会消耗 1 次配额)\n')
  process.exit(0)
}

// 候选 endpoint(按可能性排序)
const candidates = [
  '/minimax/v1/music_generation',   // 类比 /minimax/v1/video_generation 最可能
  '/v1/music_generation',           // 官方文档路径
  '/minimax/music_generation',
  '/v1/minimax/music_generation',
  '/v1/audio/music_generation',
  '/v1/music/generations',
  '/v1/musics/generations',
]

async function probe(p: string) {
  const url = `${BASE_URL}${p}`
  // 故意发空 body / 错误 body,只看路由是否存在
  const body = JSON.stringify({
    model: 'music-2.6-free',
    prompt: 'test',
    is_instrumental: true,
    output_format: 'url',
    stream: false,
  })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(60000),
    })
    const text = await res.text()
    const preview = text.length > 300 ? text.slice(0, 300) + `...(共 ${text.length} 字符)` : text
    console.log(`[${res.status}] ${p}`)
    console.log(`  ${preview.replace(/\n/g, ' ')}`)
    return { path: p, status: res.status, body: text }
  } catch (err: any) {
    console.log(`[ERR] ${p}: ${err?.message || err}`)
    return { path: p, status: 0, body: '' }
  }
}

async function main() {
  console.log('=== MiniMax music endpoint 探测 ===')
  console.log('BASE_URL:', BASE_URL)
  console.log()
  const results = []
  for (const c of candidates) {
    results.push(await probe(c))
    console.log()
  }
  console.log('=== 汇总 ===')
  for (const r of results) {
    const flag = r.status === 200 ? '✅' : r.status === 404 ? '❌' : '⚠️'
    console.log(`${flag} [${r.status}] ${r.path}`)
  }
}

main().catch((err) => {
  console.error('未捕获:', err)
  process.exit(1)
})
