/**
 * MiniMax TTS 官方 API 客户端
 *
 * 端点：POST https://api.minimaxi.com/v1/t2a_v2
 * 文档参考：MiniMax 语音合成 API（2026-07）
 *
 * 特性：
 * - 同步返回音频 URL（output_format='url'），无需轮询
 * - 支持 emotion、speed、pitch、vol 等 voice_setting
 * - 失败时抛出 MinimaxTtsError，上层决定是否兜底
 */

const MINIMAX_TTS_API_KEY = process.env.MINIMAX_API_KEY || ''
const MINIMAX_TTS_BASE_URL = 'https://api.minimaxi.com'

export interface MinimaxTtsOptions {
  /** 模型 ID，默认 speech-2.8-hd */
  model?: string
  /** 音色 ID，默认中文抒情女声 */
  voiceId?: string
  /** 语速，默认 1.0 */
  speed?: number
  /** 音量，默认 1.0 */
  vol?: number
  /** 音高，默认 0 */
  pitch?: number
  /** 情感，默认 neutral */
  emotion?: string
  /** 输出格式：url 或 hex，默认 url */
  outputFormat?: 'url' | 'hex'
  /** 采样率，默认 32000 */
  sampleRate?: number
  /** 比特率，默认 128000 */
  bitrate?: number
  /** 音频格式，默认 mp3 */
  format?: 'mp3' | 'wav' | 'pcm' | 'ogg' | 'flac' | 'aac'
  /** 声道，默认 1 */
  channel?: number
}

export interface MinimaxTtsResult {
  /** 音频下载 URL（MiniMax 官方返回，24h 有效） */
  audioUrl: string
  /** 音频时长（毫秒） */
  durationMs: number
  /** 音频大小（字节） */
  audioSize: number
  /** 实际使用的模型 */
  model: string
  /** 实际使用的音色 */
  voiceId: string
  /** 输出格式 */
  outputFormat: 'url' | 'hex'
}

export class MinimaxTtsError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'MinimaxTtsError'
    this.statusCode = statusCode
  }
}

function getErrorHint(statusCode: number): string {
  switch (statusCode) {
    case 1002:
      return '（限流，稍后重试）'
    case 1004:
      return '（API Key 鉴权失败，检查 MINIMAX_API_KEY）'
    case 1008:
      return '（账户余额不足）'
    case 1026:
      return '（文本涉及敏感内容）'
    case 2013:
      return '（参数异常）'
    case 2049:
      return '（无效 API Key）'
    default:
      return ''
  }
}

/**
 * 调用 MiniMax TTS 生成语音。
 *
 * @param text 要合成的文本（中文/英文均可）
 * @param options 音色、语速、格式等选项
 * @returns 音频 URL 与时长信息
 */
export async function generateSpeechMinimax(
  text: string,
  options: MinimaxTtsOptions = {}
): Promise<MinimaxTtsResult> {
  if (!MINIMAX_TTS_API_KEY) {
    throw new Error('MINIMAX_API_KEY not configured in environment')
  }

  const model = options.model || 'speech-2.8-hd'
  const voiceId = options.voiceId || 'Chinese (Mandarin)_Lyrical_Voice'
  const outputFormat = options.outputFormat || 'url'
  const sampleRate = options.sampleRate ?? 32000
  const bitrate = options.bitrate ?? 128000
  const format = options.format || 'mp3'
  const channel = options.channel ?? 1

  const body: Record<string, any> = {
    model,
    text: text.slice(0, 8000), // 防御：避免文本过长
    stream: false,
    output_format: outputFormat,
    voice_setting: {
      voice_id: voiceId,
      speed: options.speed ?? 1,
      vol: options.vol ?? 1,
      pitch: options.pitch ?? 0,
      emotion: options.emotion || 'neutral',
    },
    audio_setting: {
      sample_rate: sampleRate,
      bitrate,
      format,
      channel,
    },
  }

  const endpoint = `${MINIMAX_TTS_BASE_URL}/v1/t2a_v2`
  const bodyStr = JSON.stringify(body)

  console.log(`[MINIMAX-TTS] → POST ${endpoint}`, bodyStr.slice(0, 300))

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MINIMAX_TTS_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: bodyStr,
    signal: AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined,
  })

  const responseText = await res.text()
  console.log(
    '[MINIMAX-TTS] ←',
    res.status,
    responseText.length > 600
      ? responseText.slice(0, 600) + '...(audio 已截断)'
      : responseText
  )

  if (!res.ok) {
    throw new MinimaxTtsError(res.status, `HTTP ${res.status}: ${responseText.slice(0, 300)}`)
  }

  let data: any
  try {
    data = JSON.parse(responseText)
  } catch {
    throw new Error(`MiniMax TTS returned non-JSON: ${responseText.slice(0, 200)}`)
  }

  const statusCode: number | undefined = data?.base_resp?.status_code
  const statusMsg: string = data?.base_resp?.status_msg || ''
  if (statusCode !== 0) {
    throw new MinimaxTtsError(
      statusCode ?? -1,
      `MiniMax TTS 失败: ${statusMsg} code=${statusCode}${getErrorHint(statusCode ?? -1)}`
    )
  }

  const dataStatus: number | undefined = data?.data?.status
  if (dataStatus !== 2) {
    throw new MinimaxTtsError(
      -2,
      `MiniMax TTS 未完成: data.status=${dataStatus} (1=合成中, 2=已完成)`
    )
  }

  const audioData: string | undefined = data?.data?.audio
  if (!audioData) {
    throw new Error(`MiniMax TTS 响应中无 audio 字段: ${responseText.slice(0, 200)}`)
  }

  const durationMs: number = data?.extra_info?.audio_length || 0
  const audioSize: number = data?.extra_info?.audio_size || 0

  if (outputFormat === 'url') {
    if (!/^https?:\/\//i.test(audioData)) {
      throw new Error(`MiniMax TTS output_format=url 但 audio 字段非 http 链接: ${audioData.slice(0, 80)}`)
    }
    console.log('[MINIMAX-TTS] ✅ 获取音频 URL:', audioData.slice(0, 80))
    return {
      audioUrl: audioData,
      durationMs,
      audioSize,
      model,
      voiceId,
      outputFormat: 'url',
    }
  }

  // outputFormat === 'hex'：返回 hex 字符串，由上层解码
  return {
    audioUrl: audioData,
    durationMs,
    audioSize,
    model,
    voiceId,
    outputFormat: 'hex',
  }
}

/**
 * 推荐的中文/英文常用音色列表（MiniMax）。
 * 实际可用音色以 MiniMax 控制台为准。
 */
export const MINIMAX_TTS_VOICES = [
  { id: 'Chinese (Mandarin)_Lyrical_Voice', label: '中文-抒情女声', lang: 'zh' },
  { id: 'Chinese (Mandarin)_Standard_Male', label: '中文-标准男声', lang: 'zh' },
  { id: 'Chinese (Mandarin)_Gentle_Voice', label: '中文-温柔女声', lang: 'zh' },
  { id: 'Chinese (Mandarin)_Energetic_Voice', label: '中文-活力男声', lang: 'zh' },
  { id: 'English (US)_Standard_Female', label: '英文-标准女声', lang: 'en' },
  { id: 'English (US)_Standard_Male', label: '英文-标准男声', lang: 'en' },
]
