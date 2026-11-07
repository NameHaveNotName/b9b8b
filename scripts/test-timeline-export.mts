import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { buildTimelineExportJobs, exportTimelineJobs } from '../lib/video-timeline-export.ts'

// Manual repair integration fixture. This is intentionally not the normal
// generation-unit assembly path, which preserves every returned clip whole.

const execFileAsync = promisify(execFile)
const bundledLocalFfmpeg = process.env.APPDATA
  ? path.join(process.env.APPDATA, 's7z', 'ffmpeg.exe')
  : null
const ffmpegBinary = process.env.FFMPEG_PATH
  || (bundledLocalFfmpeg && existsSync(bundledLocalFfmpeg) ? bundledLocalFfmpeg : null)
  || ffmpegPath
if (!ffmpegBinary) throw new Error('ffmpeg binary is unavailable')

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'timeline-export-'))
try {
  const sourcePath = path.join(tempDir, 'source.mp4')
  const outputDir = path.join(tempDir, 'cuts')
  await mkdir(outputDir)
  await execFileAsync(ffmpegBinary, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x180:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourcePath,
  ], { maxBuffer: 16 * 1024 * 1024 })

  const jobs = buildTimelineExportJobs([
    {
      id: 'shot-a', sequence: 0, sourcePath, sourceDurationMs: 4000,
      sourceStartMs: 500, sourceEndMs: 1700, timelineStartMs: 0, timelineEndMs: 1200,
    },
    {
      id: 'shot-b', sequence: 1, sourcePath, sourceDurationMs: 4000,
      sourceStartMs: 2200, sourceEndMs: 3700, timelineStartMs: 1200, timelineEndMs: 2700,
    },
  ], outputDir)
  const outputs = await exportTimelineJobs(jobs)
  assert.equal(outputs.length, 2)
  for (const output of outputs) assert.ok((await stat(output)).size > 1000)
  console.log('timeline export integration: ok')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
