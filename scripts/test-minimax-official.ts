/**
 * 测试 MiniMax 官方 API 音乐生成
 * 运行: npx tsx scripts/test-minimax-official.ts --yes
 */
import fs from 'fs'
import path from 'path'

const MINIMAX_API_KEY = 'sk-cp-PGjJcZY1YinI9d-WpH_6VY49xmIYlnvGKlQnO9QCq3y4hq-cGclDWFKU4Rj9tjYdTYYbViRRPnFqaeTpoD6WvhgBf2lcBaIEggqAjl5cQf4ervVWCfwKk1A'

// MiniMax 官方 endpoint（根据文档）
const OFFICIAL_URL = 'https://api.minimax.chat/v1/music_generation'

const _confirmed = process.argv.includes('--yes')
if (!_confirmed) {
  console.error('⚠️  加 --yes 才会发请求')
  process.exit(0)
}

async function testModel(model: string, format: 'url' | 'hex') {
  const body = {
    model,
    prompt: 'Epic cinematic trailer music, orchestral, dramatic, intense battle scene',
    is_instrumental: true,
    output_format: format,
    stream: false,
  }

  console.log(`\n=== 测试 model=${model} format=${format} ===`)
  console.log('URL:', OFFICIAL_URL)
  console.log('Body:', JSON.stringify(body, null, 2))

  try {
    const res = await fetch(OFFICIAL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })

    const text = await res.text()
    console.log('HTTP status:', res.status, res.statusText)

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      console.log('响应不是 JSON:', text.slice(0, 500))
      return
    }

    console.log('响应:', JSON.stringify(data, null, 2).slice(0, 1000))

    const sc = data.base_resp?.status_code
    if (sc !== 0) {
      console.error(`❌ 业务失败: ${data.base_resp?.status_msg} (code: ${sc})`)
      return
    }

    if (data.data?.status !== 2) {
      console.error(`❌ 合成未完成 status=${data.data?.status}`)
      return
    }

    const audio = data.data?.audio
    if (!audio) {
      console.error('❌ 无 audio 数据')
      return
    }

    console.log('✅ 成功! audio:', audio.slice(0, 100))

    if (audio.startsWith('http')) {
      const audioRes = await fetch(audio)
      const buf = Buffer.from(await audioRes.arrayBuffer())
      const outDir = path.join(process.cwd(), '.test-output')
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
      const outPath = path.join(outDir, `minimax-${model.replace(/[^a-z0-9.-]/g, '_')}-${format}.mp3`)
      fs.writeFileSync(outPath, buf)
      console.log(`✅ 已下载: ${outPath} (${buf.length} bytes)`)
    } else {
      const buf = Buffer.from(audio, 'hex')
      const outDir = path.join(process.cwd(), '.test-output')
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
      const outPath = path.join(outDir, `minimax-${model.replace(/[^a-z0-9.-]/g, '_')}-${format}.mp3`)
      fs.writeFileSync(outPath, buf)
      console.log(`✅ 已解码保存: ${outPath} (${buf.length} bytes)`)
    }
  } catch (err: any) {
    console.error('❌ 异常:', err?.message || err)
  }
}

async function main() {
  console.log('[TEST-MINIMAX-OFFICIAL] 开始测试 MiniMax 官方 API')
  // 测试 1: music-2.6-free + url
  await testModel('music-2.6-free', 'url')
  // 测试 2: music-2.6 + url
  await testModel('music-2.6', 'url')
  // 测试 3: music-2.6-free + hex
  await testModel('music-2.6-free', 'hex')
}

main().catch(console.error)
