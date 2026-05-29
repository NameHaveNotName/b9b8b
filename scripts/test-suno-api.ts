/**
 * 工作指令.txt（2026-05-18）：独立测试 Suno 音乐生成 API 连通性。
 *
 * 验证内容：
 *   1. POST /suno/submit/music 能否返回 task_id
 *   2. GET  /suno/fetch/{task_id} 能否轮询到 SUCCESS 状态
 *   3. GET  /suno/act/wav/{clip_id} 能否拿到 wav URL
 *
 * 运行：
 *   npx tsx scripts/test-suno-api.ts
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

if (!API_KEY) {
  console.error('[TEST-SUNO] ❌ XIAOMI_API_KEY 未配置')
  process.exit(1)
}

// 2026-05-18:防止误跑消耗供应商 Suno 任务额度,必须显式确认才会真正提交。
const _confirmed = process.argv.includes('--yes') || process.env.SUNO_TEST_CONFIRM === '1'
if (!_confirmed) {
  console.error('\n⚠️  [TEST-SUNO] 此脚本会向 Suno 真实提交 1 个音乐生成任务(消耗供应商额度)')
  console.error('   如果确认要运行,请加 --yes 参数:')
  console.error('   npx tsx scripts/test-suno-api.ts --yes')
  console.error('   或设置环境变量 SUNO_TEST_CONFIRM=1\n')
  process.exit(0)
}

async function submitSuno(): Promise<string | null> {
  const body = {
    prompt: '科幻悬疑感的电影配乐，逐渐变强，atmospheric',
    mv: 'chirp-v4',
    title: 'Trailer BGM Test',
    tags: 'cinematic orchestral dark',
    make_instrumental: true,
    task: 'generate',
  }

  console.log('\n========== [TEST-SUNO-SUBMIT] 请求 ==========')
  console.log('URL:', `${BASE_URL}/suno/submit/music`)
  console.log('Headers: Authorization=Bearer', API_KEY.slice(0, 8) + '...')
  console.log('Body:', JSON.stringify(body))

  try {
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
    console.log('\n========== [TEST-SUNO-SUBMIT] 响应 ==========')
    console.log('Status:', res.status, res.statusText)
    console.log('Content-Type:', res.headers.get('content-type'))
    console.log('Body:', text.slice(0, 1500))

    if (!res.ok) {
      console.error(`[TEST-SUNO-SUBMIT] ❌ HTTP ${res.status} (供应商错误,需联系渠道)`)
      return null
    }

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      console.error('[TEST-SUNO-SUBMIT] ❌ JSON 解析失败')
      return null
    }

    const taskId: string | undefined =
      typeof data?.data === 'string' ? data.data : data?.data?.task_id || data?.task_id
    if (!taskId) {
      console.error('[TEST-SUNO-SUBMIT] ❌ 响应缺少 task_id:', JSON.stringify(data, null, 2))
      return null
    }
    console.log(`[TEST-SUNO-SUBMIT] ✅ 提交成功 task_id=${taskId}`)
    return taskId
  } catch (err: any) {
    console.error('[TEST-SUNO-SUBMIT] ❌ 异常:', err?.message)
    return null
  }
}

async function pollSuno(taskId: string, maxAttempts = 60, intervalMs = 5000) {
  console.log(`\n========== [TEST-SUNO-POLL] 开始轮询 task_id=${taskId} ==========`)
  const queryUrls = [
    `${BASE_URL}/suno/fetch/${encodeURIComponent(taskId)}`,
    `${BASE_URL}/suno/fetch?task_id=${encodeURIComponent(taskId)}`,
  ]

  let lastStatus = ''
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs))

    for (const url of queryUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${API_KEY}` },
        })
        const text = await res.text()
        if (!res.ok) {
          if (attempt === 0) {
            console.log(`[TEST-SUNO-POLL] url=${url.slice(-50)} HTTP ${res.status}: ${text.slice(0, 200)}`)
          }
          continue
        }
        const data = JSON.parse(text)
        const status: string = (data?.data?.status || data?.status || '').toUpperCase()
        const clips = data?.data?.clips || (Array.isArray(data?.data) ? data.data : null)
        const firstClip = Array.isArray(clips) ? clips[0] : data?.data
        const clipId: string | undefined = firstClip?.id || firstClip?.clip_id
        const audioUrl: string | undefined = firstClip?.audio_url || data?.audio_url

        const tag = `attempt=${attempt + 1}/${maxAttempts} status=${status} hasClip=${!!clipId} hasAudio=${!!audioUrl}`
        if (tag !== lastStatus) {
          console.log(`[TEST-SUNO-POLL] ${tag}`)
          if (attempt < 2) {
            console.log(`[TEST-SUNO-POLL] 响应预览:`, text.slice(0, 500))
          }
          lastStatus = tag
        }

        if (clipId && audioUrl && (status === 'SUCCESS' || status === 'COMPLETED' || status === 'STREAMING')) {
          console.log(`\n✅ Suno 音乐生成成功!`)
          console.log(`   clipId: ${clipId}`)
          console.log(`   audio_url: ${audioUrl}`)
          return { clipId, audioUrl }
        }
        if (status === 'FAILED' || status === 'FAILURE' || status === 'ERROR') {
          console.error(`[TEST-SUNO-POLL] ❌ 任务失败: ${text.slice(0, 500)}`)
          return null
        }
        break
      } catch (err: any) {
        // 继续尝试下一个 URL
      }
    }
  }

  console.log(`⏰ 轮询超时(${(maxAttempts * intervalMs) / 1000}s)`)
  return null
}

async function downloadWav(clipId: string) {
  console.log(`\n========== [TEST-SUNO-WAV] 请求 ==========`)
  const url = `${BASE_URL}/suno/act/wav/${encodeURIComponent(clipId)}`
  console.log('URL:', url)

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    })
    const text = await res.text()
    console.log('Status:', res.status, res.statusText)
    console.log('Body:', text.slice(0, 1500))

    if (!res.ok) {
      console.error(`[TEST-SUNO-WAV] ❌ HTTP ${res.status}`)
      return
    }
    const data = JSON.parse(text)
    const wavUrl: string | undefined =
      typeof data?.data === 'string' ? data.data : data?.data?.url || data?.data?.wav_url || data?.url
    if (wavUrl) {
      console.log(`✅ Suno WAV 下载 URL: ${wavUrl}`)
    } else {
      console.error('❌ 响应缺少 wav URL')
    }
  } catch (err: any) {
    console.error('[TEST-SUNO-WAV] ❌ 异常:', err?.message)
  }
}

async function main() {
  console.log('========== [TEST-SUNO] 配置 ==========')
  console.log('API Base:', BASE_URL)
  console.log('API Key:', API_KEY.slice(0, 8) + '...' + API_KEY.slice(-4))

  const taskId = await submitSuno()
  if (!taskId) {
    console.log('\n========== [TEST-SUNO] 测试中止：提交失败 ==========\n')
    return
  }

  const result = await pollSuno(taskId)
  if (!result) {
    console.log('\n========== [TEST-SUNO] 测试中止：轮询未拿到结果 ==========\n')
    return
  }

  await downloadWav(result.clipId)

  console.log('\n========== [TEST-SUNO] 全部测试完成 ==========\n')
}

main().catch((err) => {
  console.error('[TEST-SUNO] 致命错误:', err)
  process.exit(1)
})
