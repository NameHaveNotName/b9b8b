/**
 * 精细过滤模型列表,寻找 music-2.6 / suno / chirp 之类的音乐生成模型。
 */
import path from 'path'
import { config } from 'dotenv'
config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

;(async () => {
  const res = await fetch(`${BASE_URL}/v1/models`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  })
  const j = await res.json()
  const list = (j?.data || j?.models || []) as any[]
  const all = list.map((m: any) => (m?.id || m?.name || m || '').toString())

  const filters = [
    { name: 'music-2.6', regex: /^music-2\.6/i },
    { name: '只含 music 不含 audio', regex: /music/i },
    { name: 'suno/chirp', regex: /suno|chirp/i },
    { name: 'cover', regex: /cover/i },
    { name: 'song', regex: /song/i },
  ]
  for (const f of filters) {
    const matched = all.filter((id) => f.regex.test(id))
    console.log(`\n[${f.name}] 共 ${matched.length}:`)
    matched.slice(0, 30).forEach((id) => console.log('  -', id))
  }

  console.log('\n\n=== 全部 453 模型(若需要全文检索可重定向到文件)===')
  console.log('(略,如需可写入文件)')
})()
