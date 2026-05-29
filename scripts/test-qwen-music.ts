/**
 * 工作指令.txt（2026-05-18）：独立测试千问百聆音乐生成 API 连通性。
 *
 * 验证内容：
 *   1. POST /services/audio/music/generation 能否返回 output.audio_url
 *   2. 音频 URL 能否下载为本地文件
 *
 * 运行：
 *   npx tsx scripts/test-qwen-music.ts --yes
 *   （或环境变量 QWEN_TEST_CONFIRM=1）
 */
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
const API_KEY = process.env.DASHSCOPE_API_KEY || ''

if (!API_KEY) {
  console.error('[TEST-QWEN] ❌ DASHSCOPE_API_KEY 未配置')
  process.exit(1)
}

// 防止误跑消耗额度,必须显式确认
const _confirmed = process.argv.includes('--yes') || process.env.QWEN_TEST_CONFIRM === '1'
if (!_confirmed) {
  console.error('\n⚠️  [TEST-QWEN] 此脚本会向千问百聆真实提交音乐生成请求(消耗额度)')
  console.error('   如果确认要运行,请加 --yes 参数:')
  console.error('   npx tsx scripts/test-qwen-music.ts --yes')
  console.error('   或设置环境变量 QWEN_TEST_CONFIRM=1\n')
  process.exit(0)
}

interface QwenResponse {
  output?: { audio_url?: string; text?: string }
  usage?: { input_tokens?: number; output_tokens?: number }
  request_id?: string
  code?: string
  message?: string
}

async function testCase(name: string, body: any) {
  console.log(`\n========== [TEST] ${name} ==========`)
  console.log('URL:', `${BASE_URL}/services/audio/music/generation`)
  console.log('Body:', JSON.stringify(body, null, 2))

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/services/audio/music/generation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
  } catch (err: any) {
    console.error('❌ fetch 异常:', err?.message || err)
    return false
  }

  const text = await res.text()
  console.log('HTTP status:', res.status, res.statusText)

  let data: QwenResponse
  try {
    data = JSON.parse(text)
  } catch {
    console.error('❌ 响应不是 JSON:', text.slice(0, 500))
    return false
  }

  console.log('响应:', JSON.stringify(data, null, 2).slice(0, 800))

  if (data.code) {
    console.error(`❌ 业务错误 code=${data.code}: ${data.message}`)
    return false
  }

  const audioUrl = data.output?.audio_url
  if (!audioUrl) {
    console.error('❌ 响应中无 output.audio_url')
    return false
  }

  console.log('✅ 获取到音频 URL:', audioUrl.slice(0, 60))
  if (data.output?.text) {
    console.log('   生成歌词:', data.output.text.slice(0, 100))
  }

  // 下载测试
  try {
    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(60000) })
    if (!audioRes.ok) {
      console.error(`❌ 下载失败 HTTP ${audioRes.status}`)
      return false
    }
    const buffer = Buffer.from(await audioRes.arrayBuffer())
    const outDir = path.join(process.cwd(), '.test-output')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    const ext = (audioUrl.match(/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i)?.[1] || 'mp3').toLowerCase()
    const outPath = path.join(outDir, `qwen-test-${Date.now()}.${ext}`)
    fs.writeFileSync(outPath, buffer)
    console.log(`✅ 已下载到: ${outPath} (${buffer.length} bytes)`)
  } catch (err: any) {
    console.error('❌ 下载异常:', err?.message || err)
    return false
  }

  return true
}

async function main() {
  console.log('[TEST-QWEN] 开始测试千问百聆音乐生成')
  console.log('  BASE_URL:', BASE_URL)
  console.log('  API_KEY:', API_KEY.slice(0, 8) + '...')

  const ok1 = await testCase('纯音乐 - 史诗预告片', {
    model: 'fun-music-v1',
    input: {
      prompt: '史诗级电影预告片背景音乐，管弦乐，紧张激烈，适合战斗场景',
    },
  })

  if (!ok1) {
    console.error('\n❌ [TEST-QWEN] 测试失败')
    process.exit(1)
  }

  console.log('\n✅ [TEST-QWEN] 测试通过')
}

main().catch((err) => {
  console.error('[TEST-QWEN] 未捕获异常:', err)
  process.exit(1)
})
