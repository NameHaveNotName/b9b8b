import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import {
  downloadUrlToTemp,
  getFfmpegExecutablePath,
  makeTempDir,
  removeDir,
} from './video-utils.ts'
import { buildContactSheetFrameTimes } from './video-evidence.ts'

const execFileAsync = promisify(execFile)

export interface VideoTechnicalQualityProbe {
  hasVideoStream: boolean
  measuredDurationMs: number | null
  blackFrameRatio: number | null
  freezeFrameRatio: number | null
}

export interface RemoteVideoEvidence {
  technical: VideoTechnicalQualityProbe
  contactSheet: Buffer | null
  frameTimesMs: number[]
  contactSheetError: string | null
}

function parseClockDuration(value: string): number | null {
  const parts = value.split(':').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function summedMatches(output: string, expression: RegExp): number {
  let sum = 0
  for (const match of output.matchAll(expression)) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value > 0) sum += value
  }
  return sum
}

/** Parse deterministic ffmpeg filter logs without depending on localized console text. */
export function parseVideoTechnicalQualityOutput(output: string): VideoTechnicalQualityProbe {
  const durationMatch = output.match(/Duration:\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/i)
  const durationSeconds = durationMatch ? parseClockDuration(durationMatch[1]) : null
  const hasVideoStream = /Stream\s+#\d+:\d+[^\r\n]*?:\s+Video:/i.test(output)
  const blackSeconds = summedMatches(output, /black_duration:([0-9.]+)/g)
  const freezeSeconds = summedMatches(output, /(?:lavfi\.)?freezedetect\.freeze_duration:\s*([0-9.]+)/g)
  const ratio = (seconds: number): number | null => durationSeconds && durationSeconds > 0
    ? Math.max(0, Math.min(1, seconds / durationSeconds))
    : null
  return {
    hasVideoStream,
    measuredDurationMs: durationSeconds == null ? null : Math.round(durationSeconds * 1000),
    blackFrameRatio: ratio(blackSeconds),
    freezeFrameRatio: ratio(freezeSeconds),
  }
}

export async function analyzeVideoTechnicalQualityFile(
  inputPath: string
): Promise<VideoTechnicalQualityProbe> {
  const ffmpeg = getFfmpegExecutablePath()
  const args = [
    '-hide_banner',
    '-i', inputPath,
    '-vf', 'blackdetect=d=0.20:pix_th=0.10,freezedetect=n=-50dB:d=0.50',
    '-an',
    '-f', 'null',
    '-',
  ]
  try {
    const result = await execFileAsync(ffmpeg, args, { maxBuffer: 32 * 1024 * 1024 })
    return parseVideoTechnicalQualityOutput(`${result.stdout || ''}\n${result.stderr || ''}`)
  } catch (error: any) {
    const parsed = parseVideoTechnicalQualityOutput(`${error?.stdout || ''}\n${error?.stderr || ''}`)
    if (parsed.hasVideoStream) return parsed
    throw new Error(`视频技术探测失败：${String(error?.message || error).slice(0, 300)}`)
  }
}

export async function createVideoContactSheetFile(
  inputPath: string,
  outputPath: string,
  durationMs: number
): Promise<number[]> {
  const ffmpeg = getFfmpegExecutablePath()
  const safeDurationMs = Math.max(1, Math.round(durationMs))
  const framesPerSecond = Math.max(0.001, 9000 / safeDurationMs)
  const filter = `fps=${framesPerSecond.toFixed(6)},scale=320:-2,tile=3x3:nb_frames=9:padding=4:margin=4:color=white`
  await execFileAsync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-vf', filter,
    '-frames:v', '1',
    '-q:v', '3',
    outputPath,
  ], { maxBuffer: 32 * 1024 * 1024 })
  return buildContactSheetFrameTimes(safeDurationMs, 9)
}

export async function createVideoFrameFile(
  inputPath: string,
  outputPath: string,
  timeMs: number
): Promise<void> {
  const ffmpeg = getFfmpegExecutablePath()
  const seekSeconds = Math.max(0, Math.round(timeMs)) / 1000
  await execFileAsync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', seekSeconds.toFixed(3),
    '-i', inputPath,
    '-frames:v', '1',
    '-q:v', '2',
    outputPath,
  ], { maxBuffer: 32 * 1024 * 1024 })
}

export async function extractRemoteVideoFrame(videoUrl: string, timeMs: number): Promise<Buffer> {
  const tempDir = await makeTempDir('video-anchor-')
  const localPath = path.join(tempDir, 'candidate.mp4')
  const framePath = path.join(tempDir, 'anchor.jpg')
  try {
    await downloadUrlToTemp(videoUrl, localPath)
    await createVideoFrameFile(localPath, framePath, timeMs)
    return await fs.readFile(framePath)
  } finally {
    await removeDir(tempDir)
  }
}

/** Download once, then produce both objective probe data and a nine-frame contact sheet. */
export async function analyzeRemoteVideoEvidence(
  videoUrl: string,
  fallbackDurationMs: number
): Promise<RemoteVideoEvidence> {
  const tempDir = await makeTempDir('video-evidence-')
  const localPath = path.join(tempDir, 'candidate.mp4')
  const contactSheetPath = path.join(tempDir, 'contact-sheet.jpg')
  try {
    await downloadUrlToTemp(videoUrl, localPath)
    const technical = await analyzeVideoTechnicalQualityFile(localPath)
    const durationMs = technical.measuredDurationMs || fallbackDurationMs
    try {
      const frameTimesMs = await createVideoContactSheetFile(localPath, contactSheetPath, durationMs)
      const contactSheet = await fs.readFile(contactSheetPath)
      return { technical, contactSheet, frameTimesMs, contactSheetError: null }
    } catch (error: any) {
      return {
        technical,
        contactSheet: null,
        frameTimesMs: [],
        contactSheetError: String(error?.message || error).slice(0, 1000),
      }
    }
  } finally {
    await removeDir(tempDir)
  }
}

/** Download a generated provider asset, probe it locally, and always clean temporary files. */
export async function analyzeRemoteVideoTechnicalQuality(
  videoUrl: string
): Promise<VideoTechnicalQualityProbe> {
  const tempDir = await makeTempDir('video-quality-')
  const localPath = path.join(tempDir, 'candidate.mp4')
  try {
    await downloadUrlToTemp(videoUrl, localPath)
    return await analyzeVideoTechnicalQualityFile(localPath)
  } finally {
    await removeDir(tempDir)
  }
}
