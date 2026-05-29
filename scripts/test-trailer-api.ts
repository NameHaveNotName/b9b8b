/**
 * 工作指令.txt（Phase 7）：独立测试 Hailuo 视频生成 + Suno 音乐生成 API 连通性。
 *
 * 运行：npx tsx scripts/test-trailer-api.ts
 */
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

// 找一张本地概念图做测试
function findTestImage(): string {
  const searchDir = path.join(process.cwd(), 'public', 'mock-storage')
  for (const dir of fs.readdirSync(searchDir)) {
    const projectDir = path.join(searchDir, dir, 'projects')
    if (!fs.existsSync(projectDir)) continue
    for (const proj of fs.readdirSync(projectDir)) {
      const conceptDir = path.join(projectDir, proj, 'concepts')
      if (!fs.existsSync(conceptDir)) continue
      const files = fs.readdirSync(conceptDir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      if (files.length > 0) return path.join(conceptDir, files[0])
    }
  }
  // fallback: 任意 PNG
  function findAnyPng(dir: string, depth = 0): string | null {
    if (depth > 6) return null
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f)
        if (fs.statSync(fp).isDirectory()) {
          const r = findAnyPng(fp, depth + 1)
          if (r) return r
        } else if (f.endsWith('.png')) {
          return fp
        }
      }
    } catch {}
    return null
  }
  const r = findAnyPng(searchDir)
  if (r) return r
  throw new Error('未找到任何 PNG 测试图片')
}

// ==================== Hailuo 测试 ====================
async function testHailuo() {
  console.log('\n========== [TEST-HAILUO] 开始 ==========\n')

  const imagePath = findTestImage()
  console.log('[TEST-HAILUO] 测试图片:', imagePath)

  const buffer = fs.readFileSync(imagePath)
  const ext = path.extname(imagePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  const mime = mimeMap[ext] || 'image/jpeg'
  const base64 = `data:${mime};base64,${buffer.toString('base64')}`
  console.log('[TEST-HAILUO] Base64 长度:', base64.length)

  const body = {
    model: 'MiniMax-Hailuo-02',
    prompt: 'A cinematic scene with slow camera push-in, atmospheric lighting, gentle wind blowing through trees',
    duration: 6,
    resolution: '1080P',
    prompt_optimizer: true,
    fast_pretreatment: true,
    callback_url: '',
    aigc_watermark: false,
    first_frame_image: base64,
  }

  console.log('[TEST-HAILUO] 请求体:', JSON.stringify(body, null, 2).slice(0, 500) + '...')

  const res = await fetch(`${BASE_URL}/minimax/v1/video_generation`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  console.log('[TEST-HAILUO] 响应状态:', res.status)
  console.log('[TEST-HAILUO] 响应体:', text.slice(0, 1000))

  if (!res.ok) {
    console.error('[TEST-HAILUO] ❌ HTTP 错误:', res.status, text.slice(0, 500))
    return null
  }

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    console.error('[TEST-HAILUO] ❌ JSON 解析失败:', text.slice(0, 500))
    return null
  }

  const statusMsg = data?.base_resp?.status_msg || data?.message || ''
  const taskId = data?.task_id || data?.data?.task_id || ''

  if (data?.base_resp?.status_code === 0 || data?.code === 0 || data?.code === 'success') {
    console.log('[TEST-HAILUO] ✅ 提交成功！task_id:', taskId)
    // 轮询
    await pollHailuo(taskId)
    return taskId
  } else {
    console.error('[TEST-HAILUO] ❌ 提交失败:', statusMsg)
    console.error('[TEST-HAILUO] 完整响应:', JSON.stringify(data, null, 2))
    return null
  }
}

async function pollHailuo(taskId: string) {
  if (!taskId) return
  console.log('\n[TEST-HAILUO-POLL] 开始轮询 task_id:', taskId)
  const maxAttempts = 36
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 10000))

    // 尝试两种查询路径
    const queryUrls = [
      `${BASE_URL}/minimax/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
      `${BASE_URL}/minimax/v1/video_generation/${encodeURIComponent(taskId)}`,
    ]

    for (const url of queryUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${API_KEY}` },
        })
        const text = await res.text()
        if (!res.ok) continue
        const data = JSON.parse(text)
        const status = (data?.status || data?.task_status || data?.data?.status || '').toLowerCase()
        const videoUrl = data?.video_url || data?.file?.download_url || data?.data?.video_url || data?.data?.download_url

        console.log(`[TEST-HAILUO-POLL] attempt=${i + 1}/${maxAttempts} status=${status} hasUrl=${!!videoUrl}`)

        if (videoUrl && (status === 'success' || status === 'completed' || status === 'succeeded' || status === 'done' || status === 'finished' || status === 'preparing-finished')) {
          console.log('[TEST-HAILUO-POLL] ✅ 视频完成！URL:', videoUrl.slice(0, 200))
          return
        }
        if (status === 'failed' || status === 'error') {
          console.error('[TEST-HAILUO-POLL] ❌ 任务失败:', text.slice(0, 500))
          return
        }
        // 有效响应，继续下一轮
        break
      } catch (err: any) {
        // 继续尝试下一个 URL
      }
    }
  }
  console.log('[TEST-HAILUO-POLL] ⏰ 轮询超时（6 分钟）')
}

// ==================== Suno 测试 ====================
async function testSuno() {
  console.log('\n========== [TEST-SUNO] 开始 ==========\n')

  const body = {
    gpt_description_prompt: 'Epic cinematic trailer music, orchestral, intense, building tension',
    make_instrumental: true,
    mv: 'chirp-v4',
    title: 'Test Trailer BGM',
    tags: 'cinematic,epic,orchestral',
  }

  console.log('[TEST-SUNO] 请求体:', JSON.stringify(body, null, 2))

  const res = await fetch(`${BASE_URL}/suno/submit/music`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  console.log('[TEST-SUNO] 响应状态:', res.status)
  console.log('[TEST-SUNO] 响应体:', text.slice(0, 1000))

  if (!res.ok) {
    console.error('[TEST-SUNO] ❌ HTTP 错误:', res.status, text.slice(0, 500))
    return null
  }

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    console.error('[TEST-SUNO] ❌ JSON 解析失败:', text.slice(0, 500))
    return null
  }

  const taskId = typeof data?.data === 'string' ? data.data : data?.data?.task_id || data?.task_id || ''

  if (data.code === 'success' && taskId) {
    console.log('[TEST-SUNO] ✅ 提交成功！task_id:', taskId)
    await pollSuno(taskId)
    return taskId
  } else {
    console.error('[TEST-SUNO] ❌ 提交失败:', data.message || '未知错误')
    console.error('[TEST-SUNO] 完整响应:', JSON.stringify(data, null, 2))
    return null
  }
}

async function pollSuno(taskId: string) {
  if (!taskId) return
  console.log('\n[TEST-SUNO-POLL] 开始轮询 task_id:', taskId)
  const maxAttempts = 36
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 10000))

    try {
      const url = `${BASE_URL}/suno/fetch?task_id=${encodeURIComponent(taskId)}`
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
      })
      const text = await res.text()
      if (!res.ok) {
        console.log(`[TEST-SUNO-POLL] attempt=${i + 1}/${maxAttempts} HTTP ${res.status}`)
        continue
      }
      const data = JSON.parse(text)
      const statusRaw = data?.data?.status || data?.status || ''
      const status = statusRaw.toLowerCase()
      const audioUrl = data?.data?.audio_url || data?.data?.[0]?.audio_url || data?.audio_url || ''

      console.log(`[TEST-SUNO-POLL] attempt=${i + 1}/${maxAttempts} status=${statusRaw} hasAudio=${!!audioUrl}`)

      if (audioUrl && (status === 'success' || status === 'completed' || status === 'complete' || status === '' || status === 'streaming')) {
        console.log('[TEST-SUNO-POLL] ✅ 音频完成！URL:', audioUrl.slice(0, 200))
        return
      }
      if (status === 'failed' || status === 'error' || status === 'failure') {
        console.error('[TEST-SUNO-POLL] ❌ 任务失败:', text.slice(0, 500))
        return
      }
    } catch (err: any) {
      console.warn(`[TEST-SUNO-POLL] 轮询异常:`, err?.message)
    }
  }
  console.log('[TEST-SUNO-POLL] ⏰ 轮询超时（6 分钟）')
}

// ==================== 主入口 ====================
async function main() {
  console.log('[TEST] API Base:', BASE_URL)
  console.log('[TEST] API Key:', API_KEY.slice(0, 8) + '...' + API_KEY.slice(-4))

  // 先测 Hailuo
  await testHailuo()

  // 再测 Suno
  await testSuno()

  console.log('\n========== [TEST] 全部测试完成 ==========\n')
}

main().catch((err) => {
  console.error('[TEST] 致命错误:', err)
  process.exit(1)
})
