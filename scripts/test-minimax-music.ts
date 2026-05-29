/**
 * 工作指令.txt(2026-05-18):独立测试 MiniMax 音乐生成 API 连通性,替代 Suno。
 *
 * 验证内容:
 *   1. POST /v1/music_generation 同步接口能否返回 base_resp.status_code=0
 *   2. data.status === 2 表示合成已完成
 *   3. output_format='url' 时 data.audio 是 http(s) 链接,可直接下载到本地
 *   4. (可选)output_format='hex' 备用方案,把 16 进制字符串解码并写本地 mp3
 *
 * 运行:
 *   npx tsx scripts/test-minimax-music.ts --yes
 *   (或环境变量 MINIMAX_TEST_CONFIRM=1)
 */
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

if (!API_KEY) {
  console.error('[TEST-MINIMAX-MUSIC] ❌ XIAOMI_API_KEY 未配置')
  process.exit(1)
}

// 2026-05-18:防止误跑消耗供应商 MiniMax 音乐生成额度,必须显式确认才会真正提交。
const _confirmed = process.argv.includes('--yes') || process.env.MINIMAX_TEST_CONFIRM === '1'
if (!_confirmed) {
  console.error('\n⚠️  [TEST-MINIMAX-MUSIC] 此脚本会向 MiniMax 真实提交音乐生成请求(消耗供应商额度)')
  console.error('   如果确认要运行,请加 --yes 参数:')
  console.error('   npx tsx scripts/test-minimax-music.ts --yes')
  console.error('   或设置环境变量 MINIMAX_TEST_CONFIRM=1\n')
  process.exit(0)
}

interface MinimaxResponse {
  base_resp?: { status_code?: number; status_msg?: string }
  data?: { status?: number; audio?: string }
}

async function testMusic(model: string, format: 'url' | 'hex'): Promise<boolean> {
  const body = {
    model,
    prompt: 'Epic cinematic trailer music, orchestral, dramatic, intense battle scene, building tension, suspenseful',
    is_instrumental: true,
    output_format: format,
    stream: false,
  }

  console.log(`\n========== [TEST] model=${model} format=${format} ==========`)
  console.log('URL:', `${BASE_URL}/v1/music_generation`)
  console.log('Headers: Authorization=Bearer', API_KEY.slice(0, 8) + '...')
  console.log('Body:', JSON.stringify(body))

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/v1/music_generation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
  } catch (err: any) {
    console.error('❌ fetch 抛出异常:', err?.message || err)
    return false
  }

  const text = await res.text()
  console.log('HTTP status:', res.status, res.statusText)
  let data: MinimaxResponse
  try {
    data = JSON.parse(text) as MinimaxResponse
  } catch {
    console.error('❌ 响应不是 JSON:', text.slice(0, 500))
    return false
  }

  // 截断 audio 字段后打印,避免控制台被 hex 撑爆
  const audioField = data.data?.audio
  const audioPreview = typeof audioField === 'string'
    ? (audioField.length > 200 ? audioField.slice(0, 200) + `...(共 ${audioField.length} 字符)` : audioField)
    : audioField
  console.log('响应:', JSON.stringify({ ...data, data: { ...data.data, audio: audioPreview } }, null, 2))

  const sc = data.base_resp?.status_code
  if (sc !== 0) {
    console.error(`❌ 业务失败 status_code=${sc} msg=${data.base_resp?.status_msg}`)
    return false
  }
  if (data.data?.status !== 2) {
    console.error(`❌ 音乐合成未完成 data.status=${data.data?.status} (1=合成中, 2=已完成)`)
    return false
  }
  if (!audioField) {
    console.error('❌ data.audio 为空')
    return false
  }

  console.log('✅ status_code=0 + data.status=2 + 含 audio')

  // 下载/解码到本地
  const outDir = path.join(process.cwd(), '.test-output')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `minimax-${model.replace(/[^a-z0-9.-]/gi, '_')}-${format}.mp3`)

  if (audioField.startsWith('http://') || audioField.startsWith('https://')) {
    console.log('   audio 是 URL → 开始下载...')
    try {
      const audioRes = await fetch(audioField, { signal: AbortSignal.timeout(60000) })
      if (!audioRes.ok) {
        console.error(`   ❌ 下载失败 HTTP ${audioRes.status}`)
        return false
      }
      const buf = Buffer.from(await audioRes.arrayBuffer())
      fs.writeFileSync(outPath, buf)
      console.log(`   ✅ 已下载到: ${outPath} (${buf.length} bytes)`)
    } catch (err: any) {
      console.error('   ❌ 下载异常:', err?.message || err)
      return false
    }
  } else {
    // hex 字符串
    console.log(`   audio 是 hex(长度=${audioField.length}) → 解码保存...`)
    try {
      const buf = Buffer.from(audioField, 'hex')
      if (buf.length < 100) {
        console.error(`   ❌ 解码后字节数过小 (${buf.length}),可能 hex 不合法`)
        return false
      }
      fs.writeFileSync(outPath, buf)
      console.log(`   ✅ 已解码保存到: ${outPath} (${buf.length} bytes)`)
    } catch (err: any) {
      console.error('   ❌ 解码异常:', err?.message || err)
      return false
    }
  }
  return true
}

async function main() {
  console.log('[TEST-MINIMAX-MUSIC] 开始测试')
  console.log('  BASE_URL:', BASE_URL)
  console.log('  API_KEY:', API_KEY.slice(0, 8) + '...')

  // 测试 1:限免版 + url(优先方案)
  const ok1 = await testMusic('music-2.6-free', 'url')

  if (!ok1) {
    console.log('\n[TEST-MINIMAX-MUSIC] url 模式失败,继续测试 hex 模式作为 fallback...')
    const ok2 = await testMusic('music-2.6-free', 'hex')
    if (!ok2) {
      console.error('\n❌ [TEST-MINIMAX-MUSIC] url + hex 两种模式均失败')
      process.exit(1)
    }
    console.log('\n✅ [TEST-MINIMAX-MUSIC] hex 模式可用(url 不可用)')
  } else {
    console.log('\n✅ [TEST-MINIMAX-MUSIC] url 模式可用,首选方案验证通过')
  }
}

main().catch((err) => {
  console.error('[TEST-MINIMAX-MUSIC] 未捕获异常:', err)
  process.exit(1)
})
