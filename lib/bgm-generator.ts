/**
 * 宣传片 BGM 生成器
 *
 * 降级链：千问百聆(DashScope fun-music-v1) → MiniMax(music-2.6-free) → 静音 AAC
 * 任意一环失败都会自动降级，保证宣传片流程不中断。
 */

import path from 'path'
import { generateMusicMinimax, decodeMinimaxHexToFile } from './api-clients/xiaomi'
import { generateMusicQwen } from './api-clients/dashscope'
import { MUSIC_MODELS } from './models-config'
import { generateSilentBgm, downloadUrlToTemp } from './video-utils'

export interface BgmResult {
  bgmPath: string
  bgmExt: string
  bgmMime: string
  bgmIsMock: boolean
}

export async function generateTrailerBgm(args: {
  tempDir: string
  durationSec: number
  storyBrief?: string
  acts?: any[]
}): Promise<BgmResult> {
  const { tempDir, durationSec, storyBrief, acts } = args
  const overallMood =
    acts?.find((a: any) => a)?.mood || acts?.find((a: any) => a)?.tone || 'cinematic'

  let bgmPath = path.join(tempDir, 'bgm.aac')
  let bgmExt = 'aac'
  let bgmMime = 'audio/aac'
  let bgmIsMock = true

  try {
    // 1) 优先尝试千问百聆
    const qwenPrompt = [
      '史诗级电影预告片背景音乐',
      `情绪: ${overallMood}`,
      '风格: 管弦乐,紧张激烈,气势磅礴',
      storyBrief ? `故事背景: ${storyBrief.slice(0, 200)}` : '',
    ]
      .filter(Boolean)
      .join('，')
    console.log(
      `[TRAILER-BGM] 千问百聆 prompt="${qwenPrompt.slice(0, 120)}..." duration=${durationSec}s`
    )

    const qwenRes = await generateMusicQwen({ prompt: qwenPrompt, duration: durationSec })
    const audioUrl = qwenRes.url
    const guessExt = (audioUrl.match(/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i)?.[1] || 'mp3').toLowerCase()
    bgmExt = guessExt
    bgmMime = guessExt === 'mp3' ? 'audio/mpeg' : guessExt === 'wav' ? 'audio/wav' : `audio/${guessExt}`
    bgmPath = path.join(tempDir, `bgm.${bgmExt}`)
    await downloadUrlToTemp(audioUrl, bgmPath)
    bgmIsMock = false
    console.log(
      `[TRAILER-BGM] 千问百聆真实音乐就绪 ext=${bgmExt} path=${bgmPath} requestId=${qwenRes.requestId}`
    )
  } catch (qwenErr: any) {
    console.warn(
      `[TRAILER-BGM] 千问百聆失败,尝试 MiniMax fallback:${(
        qwenErr?.message || qwenErr
      )
        .toString()
        .slice(0, 200)}`
    )

    // 2) MiniMax fallback
    try {
      const musicCfg = (MUSIC_MODELS as any).trailer || {}
      const minimaxModel: string = musicCfg.minimaxModel || 'music-2.6-free'
      const minimaxPrompt = [
        'Epic cinematic trailer music',
        `Mood: ${overallMood}`,
        'Style: orchestral, dramatic, intense, building tension',
        storyBrief ? `Story context: ${storyBrief.slice(0, 300)}` : '',
      ]
        .filter(Boolean)
        .join('. ')
        .slice(0, 800)
      console.log(
        `[TRAILER-BGM] MiniMax prompt="${minimaxPrompt.slice(0, 120)}..." model=${minimaxModel} duration=${durationSec}s`
      )

      let bgmRemoteUrl: string | undefined
      let bgmLocalPath: string | undefined
      try {
        const music = await generateMusicMinimax({
          prompt: minimaxPrompt,
          model: minimaxModel,
          isInstrumental: true,
          outputFormat: 'url',
          duration: durationSec,
        })
        if (music.outputFormat === 'url') {
          bgmRemoteUrl = music.url
        } else {
          const ext = 'mp3'
          const localPath = path.join(tempDir, `bgm.${ext}`)
          decodeMinimaxHexToFile(music.url, localPath)
          bgmLocalPath = localPath
          bgmExt = ext
          bgmMime = 'audio/mpeg'
        }
      } catch (urlErr: any) {
        console.warn(
          `[TRAILER-BGM] MiniMax url 模式失败,尝试 hex 模式:${(
            urlErr?.message || urlErr
          )
            .toString()
            .slice(0, 200)}`
        )
        const musicHex = await generateMusicMinimax({
          prompt: minimaxPrompt,
          model: minimaxModel,
          isInstrumental: true,
          outputFormat: 'hex',
          duration: durationSec,
        })
        const ext = 'mp3'
        const localPath = path.join(tempDir, `bgm.${ext}`)
        decodeMinimaxHexToFile(musicHex.url, localPath)
        bgmLocalPath = localPath
        bgmExt = ext
        bgmMime = 'audio/mpeg'
      }

      if (bgmRemoteUrl) {
        const guessExt = (bgmRemoteUrl.match(/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i)?.[1] || 'mp3').toLowerCase()
        bgmExt = guessExt
        bgmMime = guessExt === 'mp3' ? 'audio/mpeg' : guessExt === 'wav' ? 'audio/wav' : `audio/${guessExt}`
        bgmPath = path.join(tempDir, `bgm.${bgmExt}`)
        await downloadUrlToTemp(bgmRemoteUrl, bgmPath)
      } else if (bgmLocalPath) {
        bgmPath = bgmLocalPath
      }
      bgmIsMock = false
      console.log(`[TRAILER-BGM] MiniMax 真实音乐就绪 ext=${bgmExt} path=${bgmPath}`)
    } catch (minimaxErr: any) {
      // 3) 最终回退: 静音
      console.warn(
        `[TRAILER-BGM] MiniMax 也失败,回退静音:${(minimaxErr?.message || minimaxErr)
          .toString()
          .slice(0, 200)}`
      )
      bgmPath = path.join(tempDir, 'bgm.aac')
      bgmMime = 'audio/aac'
      bgmExt = 'aac'
      bgmIsMock = true
      await generateSilentBgm(bgmPath, durationSec)
    }
  }

  return { bgmPath, bgmExt, bgmMime, bgmIsMock }
}
