/**
 * 探测供应商模型列表中是否存在 MiniMax 音乐模型,定位真实 endpoint。
 * 运行:npx tsx scripts/probe-models.ts
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
  const text = await res.text()
  console.log('HTTP', res.status, '内容长度', text.length)
  try {
    const j = JSON.parse(text)
    const list = (j?.data || j?.models || []) as any[]
    const all = list.map((m: any) => (m?.id || m?.name || m || '').toString())
    const music = all.filter((id) => /music|suno|minimax|cover|audio|song/i.test(id))
    console.log('\n=== 音乐相关模型 ===')
    music.forEach((id) => console.log('  -', id))
    console.log(`\n(总模型数 ${all.length},音乐相关 ${music.length})`)
  } catch {
    console.log('响应不是 JSON,前 500:', text.slice(0, 500))
  }
})()
