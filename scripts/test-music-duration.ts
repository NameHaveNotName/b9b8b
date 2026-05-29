/**
 * 测试音乐生成 API 的 duration 提示词控制效果（不裁剪）
 *
 * 对比两组测试：
 *   A. 不带时长要求（基线）→ 预期生成 1~2 分钟
 *   B. 带 duration=30 提示词 → 预期生成 ≈30 秒（或仍 1~2 分钟，说明提示词无效）
 *
 * 运行：npx tsx scripts/test-music-duration.ts --yes
 */
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import { execSync } from 'child_process'

config({ path: path.join(process.cwd(), '.env.local') })

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || ''
const XIAOMI_BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const XIAOMI_KEY = process.env.XIAOMI_API_KEY || ''

const confirmed = process.argv.includes('--yes') || process.env.MUSIC_TEST_CONFIRM === '1'
if (!confirmed) {
  console.error('\n⚠️  此脚本会向 Qwen 和 MiniMax 提交真实音乐生成请求（消耗额度）')
  console.error('   确认运行请执行：npx tsx scripts/test-music-duration.ts --yes\n')
  process.exit(0)
}

const outDir = path.join(process.cwd(), '.test-output')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

function probeDuration(filePath: string): number | null {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`, { encoding: 'utf8', timeout: 10000 })
    const sec = parseFloat(out.trim())
    return isNaN(sec) ? null : sec
  } catch {
    return null
  }
}

// ========== Qwen / DashScope ==========
async function testQwen(name: string, prompt: string, duration?: number): Promise<{ filePath: string; apiSec: number | null }> {
  console.log(`\n========== [Qwen] ${name} ==========`)
  const promptWithDuration = duration ? `${prompt}（严格控制在${duration}秒以内）` : prompt
  const body = {
    model: 'fun-music-v1',
    input: { prompt: promptWithDuration },
  }

  const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/music/generation', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DASHSCOPE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })

  const data = await res.json().catch(() => ({}))
  console.log('  原始响应:', JSON.stringify(data, null, 2).slice(0, 600))
  if (!res.ok || data?.code) {
    throw new Error(`Qwen 失败: ${data?.message || res.statusText}`)
  }

  // 工作指令.txt（2026-05-19）：响应格式可能是 output.audio.url 或 output.audio_url
  const audioUrl = data?.output?.audio?.url || data?.output?.audio_url
  if (!audioUrl) throw new Error(`Qwen 响应无 audio_url, output=${JSON.stringify(data?.output)}`)

  const buf = Buffer.from(await (await fetch(audioUrl, { signal: AbortSignal.timeout(60000) })).arrayBuffer())
  const ext = (audioUrl.match(/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i)?.[1] || 'mp3').toLowerCase()
  const filePath = path.join(outDir, `qwen-${duration ? 'with' : 'without'}-duration.${ext}`)
  fs.writeFileSync(filePath, buf)

  const sec = probeDuration(filePath)
  console.log(`  文件: ${filePath}`)
  console.log(`  大小: ${buf.length} bytes`)
  console.log(`  时长: ${sec === null ? '探测失败' : `${sec.toFixed(2)}秒 (${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')})`}`)
  console.log(`  prompt: ${promptWithDuration.slice(0, 100)}...`)
  return { filePath, apiSec: sec }
}

// ========== MiniMax ==========
async function testMinimax(name: string, prompt: string, duration?: number): Promise<{ filePath: string; apiSec: number | null }> {
  console.log(`\n========== [MiniMax] ${name} ==========`)
  const promptWithDuration = duration ? `${prompt} (Duration: strictly ${duration} seconds)` : prompt
  const body = {
    model: 'music-2.6',
    prompt: promptWithDuration,
    is_instrumental: true,
    output_format: 'url',
    stream: false,
  }

  // MiniMax 官方 API（与 xiaomi.ts 保持一致）
  const minimaxBaseUrl = 'https://api.minimax.chat'
  const minimaxKey = process.env.MINIMAX_API_KEY || ''
  const res = await fetch(`${minimaxBaseUrl}/v1/music_generation`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${minimaxKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  })

  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { throw new Error(`MiniMax 非 JSON: ${text.slice(0, 200)}`) }

  console.log('  原始响应:', JSON.stringify(data, null, 2).slice(0, 600))

  if (data?.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax 失败: ${data?.base_resp?.status_msg || JSON.stringify(data?.base_resp)}`)
  }
  if (data?.data?.status !== 2) {
    throw new Error(`MiniMax 未完成: status=${data?.data?.status}`)
  }

  const audioUrl = data?.data?.audio
  if (!audioUrl) throw new Error('MiniMax 响应无 audio')

  const buf = Buffer.from(await (await fetch(audioUrl, { signal: AbortSignal.timeout(60000) })).arrayBuffer())
  const ext = (audioUrl.match(/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i)?.[1] || 'mp3').toLowerCase()
  const filePath = path.join(outDir, `minimax-${duration ? 'with' : 'without'}-duration.${ext}`)
  fs.writeFileSync(filePath, buf)

  const sec = probeDuration(filePath)
  console.log(`  文件: ${filePath}`)
  console.log(`  大小: ${buf.length} bytes`)
  console.log(`  时长: ${sec === null ? '探测失败' : `${sec.toFixed(2)}秒 (${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')})`}`)
  console.log(`  prompt: ${promptWithDuration.slice(0, 100)}...`)
  return { filePath, apiSec: sec }
}

async function main() {
  console.log('[TEST-MUSIC-DURATION] 开始测试音乐生成时长控制效果\n')

  const results: { api: string; withDuration: boolean; sec: number | null }[] = []

  // Qwen 基线（无时长要求）
  try {
    const r = await testQwen('基线（无时长要求）', '史诗级电影预告片背景音乐，管弦乐，紧张激烈')
    results.push({ api: 'Qwen', withDuration: false, sec: r.apiSec })
  } catch (e: any) {
    console.error(`  ❌ Qwen 基线失败: ${e.message}`)
  }

  // Qwen 带时长要求
  try {
    const r = await testQwen('带30秒时长要求', '史诗级电影预告片背景音乐，管弦乐，紧张激烈', 30)
    results.push({ api: 'Qwen', withDuration: true, sec: r.apiSec })
  } catch (e: any) {
    console.error(`  ❌ Qwen 时长测试失败: ${e.message}`)
  }

  // MiniMax 基线（无时长要求）
  try {
    const r = await testMinimax('基线（无时长要求）', 'Epic cinematic trailer music, orchestral, dramatic, intense battle scene')
    results.push({ api: 'MiniMax', withDuration: false, sec: r.apiSec })
  } catch (e: any) {
    console.error(`  ❌ MiniMax 基线失败: ${e.message}`)
  }

  // MiniMax 带时长要求
  try {
    const r = await testMinimax('带30秒时长要求', 'Epic cinematic trailer music, orchestral, dramatic, intense battle scene', 30)
    results.push({ api: 'MiniMax', withDuration: true, sec: r.apiSec })
  } catch (e: any) {
    console.error(`  ❌ MiniMax 时长测试失败: ${e.message}`)
  }

  // 汇总
  console.log('\n========== 汇总 ==========')
  for (const r of results) {
    const tag = r.withDuration ? 'with-duration' : 'baseline'
    const secStr = r.sec === null ? 'N/A' : `${r.sec.toFixed(1)}s`
    console.log(`  ${r.api.padEnd(10)} ${tag.padEnd(15)} → ${secStr}`)
  }

  const qwenBase = results.find(r => r.api === 'Qwen' && !r.withDuration)?.sec
  const qwenWith = results.find(r => r.api === 'Qwen' && r.withDuration)?.sec
  const mmBase = results.find(r => r.api === 'MiniMax' && !r.withDuration)?.sec
  const mmWith = results.find(r => r.api === 'MiniMax' && r.withDuration)?.sec

  console.log('\n结论：')
  if (qwenBase && qwenWith) {
    const effective = qwenWith < qwenBase * 0.8
    console.log(`  Qwen:   基线 ${qwenBase.toFixed(1)}s → 带提示词 ${qwenWith.toFixed(1)}s，${effective ? '✅ 提示词有效' : '❌ 提示词无效（仍需裁剪）'}`)
  }
  if (mmBase && mmWith) {
    const effective = mmWith < mmBase * 0.8
    console.log(`  MiniMax: 基线 ${mmBase.toFixed(1)}s → 带提示词 ${mmWith.toFixed(1)}s，${effective ? '✅ 提示词有效' : '❌ 提示词无效（仍需裁剪）'}`)
  }
}

main().catch(e => {
  console.error('[TEST-MUSIC-DURATION] 异常:', e)
  process.exit(1)
})
