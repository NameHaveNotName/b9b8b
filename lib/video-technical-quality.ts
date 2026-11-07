import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import {
  downloadUrlToTemp,
  getFfmpegExecutablePath,
  makeTempDir,
  removeDir,
} from './video-utils.ts'

const execFileAsync = promisify(execFile)

export interface VideoTechnicalQualityProbe {
  hasVideoStream: boolean
  measuredDurationMs: number | null
  blackFrameRatio: number | null
  freezeFrameRatio: number | null
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
