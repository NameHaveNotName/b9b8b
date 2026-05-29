/**
 * 探测供应商是否有其它音乐生成 endpoint(不同命名空间)。
 * 每个候选发送 1 个 POST 请求,通过 HTTP 404/200/4xx 判断路由是否存在。
 * 运行:npx tsx scripts/probe-music-alt.ts --yes
 */
import path from 'path'
import { config } from 'dotenv'
config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

if (!API_KEY) { console.error('❌ XIAOMI_API_KEY'); process.exit(1) }
const _confirmed = process.argv.includes('--yes') || process.env.PROBE_CONFIRM === '1'
if (!_confirmed) { console.error('⚠️ 加 --yes'); process.exit(0) }

const candidates = [
  '/v1/music/suno', '/v1/music/generations', '/v1/music/create',
  '/v1/audio/generations', '/v1/audio/generate', '/v1/audio/music',
  '/suno/submit/music',       // 已知旧 Suno 路径(已有),确认是否仍路由
  '/suno/v1/music',
  '/minimax/v1/music',
  '/minimax/music',
]

async function probe(p: string) {
  const url = `${BASE_URL}${p}`
  const body = JSON.stringify({ model: 'music-2.6-free', prompt: 'test', is_instrumental: true, output_format: 'url', stream: false })
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    const preview = text.length > 300 ? text.slice(0, 300) + `...(共 ${text.length})` : text
    const isHtml = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')
    const marker = res.status === 200 && !isHtml ? '✅' : res.status === 404 ? '❌' : '⚠️'
    console.log(`${marker} [${res.status}] ${p}`)
    console.log(`   ${preview.replace(/\n/g, ' ')}`)
  } catch (err: any) { console.log(`❌ [ERR] ${p}: ${err?.message || err}`) }
}

;(async () => { for (const c of candidates) { await probe(c); console.log() } })()
