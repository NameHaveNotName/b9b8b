/**
 * 工作指令.txt（Round 7）：宣传片管线 ffmpeg 工具集
 *
 * 提供 5 个核心能力：
 *   1. downloadUrlToTemp(url)             —— 下载远程视频/图片到本地临时文件
 *   2. kenBurnsClipFromImage(imgPath)     —— 单图 → 5s Ken Burns 缓慢缩放视频（兜底用）
 *   3. concatVideos(paths[])              —— 多段视频 → 单段（统一编码，避免 PTS/SAR 错位）
 *   4. generateSilentBgm(durationSec)     —— 30s 静音 AAC 音轨（占位 BGM）
 *   5. mixAudioVideo(videoPath, audioPath) —— 视频 + 音频混音输出 MP4
 *
 * 所有函数返回本地临时文件路径，调用方负责后续上传 R2 / 清理。
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import * as os from 'os'
import ffmpegStatic from 'ffmpeg-static'

import { execSync } from 'child_process'

const execAsync = promisify(exec)

/**
 * 工作指令.txt（Phase 2 修复）：ffmpeg 路径解析 + 兜底逻辑。
 * Next.js 打包后 ffmpeg-static 路径可能被解析到 .next/server/vendor-chunks/，
 * 需要多层兜底确保找到有效的 ffmpeg 可执行文件。
 */
function resolveFfmpegPath(): string {
  console.log('[FFMPEG] resolveFfmpegPath cwd=', process.cwd(), 'platform=', process.platform)

  // 0. 环境变量最高优先级（Docker/Vercel 内可覆盖）
  if (process.env.FFMPEG_PATH) {
    const envPath = path.isAbsolute(process.env.FFMPEG_PATH)
      ? process.env.FFMPEG_PATH
      : path.join(process.cwd(), process.env.FFMPEG_PATH)
    if (fsSync.existsSync(envPath)) {
      console.log('[FFMPEG] 使用环境变量 FFMPEG_PATH:', envPath)
      return envPath
    }
    console.log('[FFMPEG] 环境变量 FFMPEG_PATH 文件不存在:', envPath)
  }

  // 1. ffmpeg-static 直接返回的路径（开发模式正常）
  console.log('[FFMPEG] ffmpeg-static import value:', ffmpegStatic)
  if (ffmpegStatic) {
    if (fsSync.existsSync(ffmpegStatic)) {
      console.log('[FFMPEG] 使用 ffmpeg-static 路径:', ffmpegStatic)
      return ffmpegStatic
    }
    console.log('[FFMPEG] ffmpeg-static 路径文件不存在:', ffmpegStatic)
  }

  // 2. 尝试 require.resolve 获取 node_modules 中的真实路径
  try {
    const resolvedPath = require.resolve('ffmpeg-static')
    console.log('[FFMPEG] require.resolve(ffmpeg-static)=', resolvedPath)
    if (fsSync.existsSync(resolvedPath)) {
      // resolvedPath 通常是 index.js，同目录下应该有 ffmpeg 可执行文件
      const dir = path.dirname(resolvedPath)
      const candidates = [
        path.join(dir, 'ffmpeg'),
        path.join(dir, 'ffmpeg.exe'),
        resolvedPath,
      ]
      for (const c of candidates) {
        if (fsSync.existsSync(c)) {
          console.log('[FFMPEG] 使用 node_modules 候选路径:', c)
          return c
        }
      }
    }
  } catch (err: any) {
    console.log('[FFMPEG] require.resolve(ffmpeg-static) 失败:', err?.message)
  }

  // 3. 直接尝试 node_modules/ffmpeg-static/ffmpeg 或 ffmpeg.exe
  try {
    const nmPaths = [
      path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
      path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    ]
    for (const nmPath of nmPaths) {
      if (fsSync.existsSync(nmPath)) {
        console.log('[FFMPEG] 使用 node_modules 直接路径:', nmPath)
        return nmPath
      }
    }
  } catch {}

  // 4. 项目根目录兜底（构建脚本可能已下载静态 ffmpeg）
  const localCandidates = [
    path.join(process.cwd(), 'ffmpeg'),
    path.join(process.cwd(), 'ffmpeg.exe'),
    '/var/task/ffmpeg',
    '/tmp/ffmpeg',
  ]
  for (const localPath of localCandidates) {
    if (fsSync.existsSync(localPath)) {
      console.log('[FFMPEG] 使用项目根目录/系统兜底路径:', localPath)
      return localPath
    }
  }

  // 5. 系统 PATH 中的 ffmpeg（Linux 用 which，Windows 用 where）
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
    const sysPath = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0]
    if (sysPath && fsSync.existsSync(sysPath)) {
      console.log('[FFMPEG] 使用系统 PATH 路径:', sysPath)
      return sysPath
    }
  } catch (err: any) {
    console.log('[FFMPEG] 系统 PATH 查找失败:', err?.message)
  }

  // 6. 尝试 require('ffmpeg-static') 的 CJS 导出（有时和 ESM import 不同）
  try {
    const cjsStatic = require('ffmpeg-static')
    console.log('[FFMPEG] require(ffmpeg-static)=', cjsStatic)
    if (cjsStatic && fsSync.existsSync(cjsStatic)) {
      console.log('[FFMPEG] 使用 require(ffmpeg-static) 路径:', cjsStatic)
      return cjsStatic
    }
  } catch (err: any) {
    console.log('[FFMPEG] require(ffmpeg-static) 失败:', err?.message)
  }

  // 7. 最终兜底：直接调用 ffmpeg（依赖系统 PATH）
  console.warn('[FFMPEG] 未找到 ffmpeg 可执行文件，尝试直接调用系统 PATH 中的 ffmpeg')
  return 'ffmpeg'
}

/** 验证 ffmpeg 是否可执行；不可执行时抛出诊断错误 */
function validateFfmpegPath(binPath: string): string {
  try {
    const version = execSync(`"${binPath}" -version`, { encoding: 'utf8', timeout: 5000 })
    console.log('[FFMPEG] 验证成功:', version.split('\n')[0])
    return binPath
  } catch (err: any) {
    console.error(`[FFMPEG] 验证失败 (${binPath}):`, err?.message)
    throw new Error(
      `ffmpeg 不可执行: ${binPath}\n` +
        `cwd=${process.cwd()} platform=${process.platform}\n` +
        `FFMPEG_PATH=${process.env.FFMPEG_PATH || '(unset)'}\n` +
        `请检查 Vercel Build Logs 中 [BUILD] 是否成功下载 ffmpeg。`
    )
  }
}

// ffmpeg 二进制路径改为懒解析，避免构建阶段执行系统探测命令
let _FFMPEG_BIN: string | undefined;
function getFfmpegBin(): string {
  if (!_FFMPEG_BIN) {
    const resolved = resolveFfmpegPath();
    _FFMPEG_BIN = validateFfmpegPath(resolved);
  }
  return _FFMPEG_BIN;
}

/** 把命令里所有路径用双引号包裹，规避 Windows 下空格/中文路径问题 */
function quote(p: string): string {
  return `"${p}"`
}

/**
 * 工作指令.txt（2026-05-11 第4部分）：统一 ffmpeg 调用入口，包裹 try/catch 并打印 stderr。
 *
 * - 成功：`[MOCK-VIDEO] <stage> 成功`
 * - 失败：`[MOCK-VIDEO] <stage> ffmpeg 失败: <message>` + `[MOCK-VIDEO] ffmpeg stderr: <stderr>`
 *   并抛出 `ffmpeg 合成失败: <message>` 让上游 catch 可以拿到统一前缀
 */
async function runFfmpeg(stage: string, cmd: string, maxBuffer = 64 * 1024 * 1024): Promise<void> {
  try {
    await execAsync(cmd, { maxBuffer })
    console.log(`[MOCK-VIDEO] ${stage} 成功`)
  } catch (err: any) {
    console.error(`[MOCK-VIDEO] ${stage} ffmpeg 失败:`, err?.message)
    console.error('[MOCK-VIDEO] ffmpeg stderr:', err?.stderr || '(no stderr captured)')
    throw new Error(`ffmpeg 合成失败(${stage}): ${err?.message || err}`)
  }
}

import { makeTempDir } from './temp-utils'
export { makeTempDir }

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

/** 删除整个目录（best effort，失败不抛） */
export async function removeDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {}
}

/**
 * 把远程 URL（http/https/data:）下载到 outputPath。
 * - 对 data:URL 自动解码 base64
 * - 对 http(s) 走 fetch
 * - 工作指令.txt（Round 14 修复三）：localhost/127.0.0.1 URL 不走 fetch，直接读文件
 */
export async function downloadUrlToTemp(url: string, outputPath: string): Promise<string> {
  if (url.startsWith('data:')) {
    const idx = url.indexOf('base64,')
    if (idx < 0) throw new Error('downloadUrlToTemp: data URL 缺少 base64 段')
    const buf = Buffer.from(url.slice(idx + 'base64,'.length), 'base64')
    await fs.writeFile(outputPath, buf)
    return outputPath
  }

  // 工作指令.txt（Round 14 修复三）：localhost URL 不走 fetch，直接读文件
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    let localPath: string
    try {
      const urlObj = new URL(url)
      localPath = path.join(process.cwd(), 'public', urlObj.pathname)
    } catch {
      throw new Error(`downloadUrlToTemp: 无法解析本地 URL: ${url.slice(0, 120)}`)
    }
    console.log(`[DOWNLOAD] 本地直读: ${localPath}`)
    const buf = await fs.readFile(localPath)
    await fs.writeFile(outputPath, buf)
    return outputPath
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`downloadUrlToTemp: ${url.slice(0, 80)} → ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(outputPath, buf)
  return outputPath
}

/**
 * 工作指令.txt（Round 7）：单图生成 5 秒 Ken Burns 视频（缓慢缩放，模拟运镜）。
 *
 * 输出参数：1920x1080 / 25fps / yuv420p / libx264，方便后续 concat 时无须再次转码。
 *
 * 关键参数：
 *   - zoompan z='min(zoom+0.0015,1.5)'：每帧放大 0.0015，最多 1.5 倍
 *   - d=125：125 帧（25fps × 5s）
 *   - s=1920x1080：输出尺寸
 */
export async function kenBurnsClipFromImage(
  imagePath: string,
  outputPath: string,
  durationSec = 5
): Promise<string> {
  const fps = 25
  const totalFrames = fps * durationSec
  const filter = [
    `zoompan=z='min(zoom+0.0015,1.5)'`,
    `d=${totalFrames}`,
    `x='iw/2-(iw/zoom/2)'`,
    `y='ih/2-(ih/zoom/2)'`,
    `s=1920x1080`,
  ].join(':')

  const cmd = [
    quote(getFfmpegBin()),
    `-y`,
    `-loop 1`,
    `-i ${quote(imagePath)}`,
    `-vf "${filter}"`,
    `-c:v libx264`,
    `-t ${durationSec}`,
    `-r ${fps}`,
    `-pix_fmt yuv420p`,
    `-an`, // 无音轨
    quote(outputPath),
  ].join(' ')

  await runFfmpeg(`kenBurns(${path.basename(outputPath)})`, cmd, 64 * 1024 * 1024)
  return outputPath
}

/**
 * 工作指令.txt（Round 7）：把多段视频拼接成 1 段。
 *
 * 用 concat demuxer + 重新编码（不能用 -c copy，因为 Veo / Ken Burns 输出参数可能不同）。
 * 输出统一为：1920x1080 / 25fps / yuv420p / libx264 / aac stereo。
 *
 * 2026-06-12 改造：拼接阶段保留音频流（删除 -an），直出视频可直接使用；
 * 宣传片后续再用 mixAudioVideo 将原声与 BGM 混音。
 */
export async function concatVideos(segmentPaths: string[], outputPath: string): Promise<string> {
  if (segmentPaths.length === 0) throw new Error('concatVideos: 空数组')

  const tempDir = path.dirname(outputPath)
  const listPath = path.join(tempDir, `concat-${Date.now()}.txt`)

  // concat demuxer 文件格式：file 'absolute path'
  // Windows 下需要把反斜杠转为正斜杠或转义，否则 ffmpeg 解析失败
  const listContent = segmentPaths
    .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`)
    .join('\n')
  await fs.writeFile(listPath, listContent, 'utf-8')

  // -fflags +genpts 修正可能错位的 PTS；统一重新编码确保兼容
  const cmd = [
    quote(getFfmpegBin()),
    `-y`,
    `-f concat`,
    `-safe 0`,
    `-i ${quote(listPath)}`,
    `-fflags +genpts`,
    `-c:v libx264`,
    `-pix_fmt yuv420p`,
    `-r 25`,
    `-vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"`,
    `-c:a aac`,
    `-b:a 128k`, // 保留/统一音频编码，直出视频可带原声
    `-movflags +faststart`,
    quote(outputPath),
  ].join(' ')

  await runFfmpeg(`concat(${segmentPaths.length}段→${path.basename(outputPath)})`, cmd, 256 * 1024 * 1024)

  await fs.unlink(listPath).catch(() => {})
  return outputPath
}

/** 检测视频文件是否包含音频流（通过 ffmpeg -i 的 stderr 解析） */
async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stderr } = await execAsync(`${quote(getFfmpegBin())} -i ${quote(videoPath)}`, {
      maxBuffer: 32 * 1024 * 1024,
    })
    return /Stream\s+#\d+:\d+(?:\(\w+\))?:\s+Audio/i.test(stderr || '')
  } catch (err: any) {
    // ffmpeg -i 无输出文件时退出码为 1，但 stderr 仍包含流信息
    return /Stream\s+#\d+:\d+(?:\(\w+\))?:\s+Audio/i.test(err?.stderr || '')
  }
}

/**
 * 工作指令.txt（Round 7）：生成 30 秒静音 AAC 音轨作为占位 BGM。
 *
 * 后续可替换为真实 AI 音乐 API（如 Suno / Udio），保持函数签名不变。
 */
export async function generateSilentBgm(
  outputPath: string,
  durationSec = 30,
  sampleRate = 44100
): Promise<string> {
  const cmd = [
    quote(getFfmpegBin()),
    `-y`,
    `-f lavfi`,
    `-i anullsrc=r=${sampleRate}:cl=stereo`,
    `-t ${durationSec}`,
    `-acodec aac`,
    `-b:a 128k`,
    quote(outputPath),
  ].join(' ')

  await runFfmpeg(`silentBgm(${durationSec}s)`, cmd, 32 * 1024 * 1024)
  return outputPath
}

/**
 * 工作指令.txt（2026-05-19 修复）：将视频裁剪到指定时长。
 * 真实 API（Veo/Hailuo）生成的视频可能超过 5s，需在 concat 前精确裁剪。
 */
export async function trimVideo(
  inputPath: string,
  outputPath: string,
  durationSec: number
): Promise<string> {
  const cmd = [
    quote(getFfmpegBin()),
    `-y`,
    `-i ${quote(inputPath)}`,
    `-ss 0`,
    `-t ${durationSec}`,
    `-c:v libx264`,
    `-pix_fmt yuv420p`,
    `-r 25`,
    `-an`,
    `-movflags +faststart`,
    quote(outputPath),
  ].join(' ')

  await runFfmpeg(`trimVideo(${durationSec}s→${path.basename(outputPath)})`, cmd, 128 * 1024 * 1024)
  return outputPath
}

/**
 * 工作指令.txt（2026-05-19 修复）：将音频裁剪到指定时长。
 * 在 mixAudioVideo 前调用，确保长音频（如 2:59 BGM）被精确裁剪到 30s。
 */
export async function trimAudio(
  inputPath: string,
  outputPath: string,
  durationSec: number
): Promise<string> {
  const cmd = [
    quote(getFfmpegBin()),
    `-y`,
    `-i ${quote(inputPath)}`,
    `-ss 0`,
    `-t ${durationSec}`,
    `-c:a aac`,
    `-b:a 128k`,
    quote(outputPath),
  ].join(' ')

  await runFfmpeg(`trimAudio(${durationSec}s→${path.basename(outputPath)})`, cmd, 32 * 1024 * 1024)
  return outputPath
}

/**
 * 工作指令.txt（2026-06-12 改造）：把音频混到视频中，输出最终 MP4。
 *
 * - 保留视频原声，将 BGM 以 0.3 音量与原声混音（amix）
 * - 若视频本身无音频流，则直接以 BGM 作为音轨
 * - -c:v copy   不重新编码视频（concatVideos 阶段已处理好）
 * - -c:a aac    音频转码为 AAC（确保 MP4 容器兼容）
 * - -shortest   两路输入取最短（确保 BGM 不溢出）
 */
export async function mixAudioVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  options?: { bgmVolume?: number }
): Promise<string> {
  const bgmVolume = options?.bgmVolume ?? 0.3
  const hasAudio = await hasAudioStream(videoPath)

  let cmd: string
  if (hasAudio) {
    // 视频有原声：原声 + BGM 混音
    cmd = [
      quote(getFfmpegBin()),
      `-y`,
      `-i ${quote(videoPath)}`,
      `-i ${quote(audioPath)}`,
      `-filter_complex`,
      `"[1:a]volume=${bgmVolume}[bgm];[0:a][bgm]amix=inputs=2:duration=first[aout]"`,
      `-map 0:v:0`,
      `-map "[aout]"`,
      `-c:v copy`,
      `-c:a aac`,
      `-b:a 128k`,
      `-shortest`,
      `-movflags +faststart`,
      quote(outputPath),
    ].join(' ')
  } else {
    // 视频无原声：直接以 BGM 作为音轨
    cmd = [
      quote(getFfmpegBin()),
      `-y`,
      `-i ${quote(videoPath)}`,
      `-i ${quote(audioPath)}`,
      `-c:v copy`,
      `-c:a aac`,
      `-b:a 128k`,
      `-map 0:v:0`,
      `-map 1:a:0`,
      `-shortest`,
      `-movflags +faststart`,
      quote(outputPath),
    ].join(' ')
  }

  await runFfmpeg(
    `mix(${hasAudio ? 'orig+bgm' : 'bgm-only'}→${path.basename(outputPath)})`,
    cmd,
    256 * 1024 * 1024
  )
  return outputPath
}
