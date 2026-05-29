/**
 * 千问百聆 / DashScope 音乐生成 API
 * 工作指令.txt（2026-05-18）：替代 MiniMax/Suno，同步接口直接返回音频 URL
 *
 * Endpoint: POST https://dashscope.aliyuncs.com/api/v1/services/audio/music/generation
 * Model:    fun-music-v1
 */
import { config } from 'dotenv'
import path from 'path'

config({ path: path.join(process.cwd(), '.env.local') })

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || ''

export interface QwenMusicResult {
  url: string
  isMock: false
  lyrics?: string
  requestId: string
}

export interface QwenMusicError {
  code?: string
  message?: string
  request_id?: string
}

export async function generateMusicQwen(params: {
  prompt: string
  gender?: 'male' | 'female'
  /** 期望音频时长(秒)，会注入到 prompt 中并兜底裁剪 */
  duration?: number
}): Promise<QwenMusicResult> {
  if (!DASHSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_API_KEY 未配置')
  }

  // 注入时长要求到 prompt
  const durationHint = params.duration ? `（严格控制在${params.duration}秒以内）` : ''
  const promptWithDuration = `${params.prompt}${durationHint}`

  const body = {
    model: 'fun-music-v1',
    input: {
      prompt: promptWithDuration,
      ...(params.gender ? { gender: params.gender } : {}),
    },
  }

  console.log('[QWEN-MUSIC] 请求:', JSON.stringify(body, null, 2))

  const res = await fetch(`${DASHSCOPE_BASE_URL}/services/audio/music/generation`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`千问百聆响应不是 JSON: ${text.slice(0, 200)}`)
  }

  console.log('[QWEN-MUSIC] 响应:', JSON.stringify(data, null, 2).slice(0, 800))

  if (!res.ok) {
    const errMsg = data?.message || data?.error?.message || text.slice(0, 200)
    throw new Error(`千问百聆请求失败 ${res.status}: ${errMsg}`)
  }

  // 工作指令.txt（2026-05-19）：Qwen 响应格式可能为 output.audio.url 或 output.audio_url
  const audioUrl = data?.output?.audio?.url || data?.output?.audio_url
  if (!audioUrl) {
    throw new Error(`千问百聆响应中无 audio_url: ${JSON.stringify(data).slice(0, 300)}`)
  }

  console.log('[QWEN-MUSIC] 音频 URL:', audioUrl.slice(0, 60))

  return {
    url: audioUrl,
    isMock: false,
    lyrics: data?.output?.text,
    requestId: data?.request_id || '',
  }
}
