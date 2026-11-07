import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { analyzeVideoTechnicalQualityFile } from '../lib/video-technical-quality.ts'
import { getFfmpegExecutablePath } from '../lib/video-utils.ts'

const execFileAsync = promisify(execFile)
const fixtureDir = await mkdtemp(join(tmpdir(), 'video-quality-test-'))
const fixturePath = join(fixtureDir, 'black-then-motion.mp4')

try {
  await execFileAsync(getFfmpegExecutablePath(), [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=320x180:r=25:d=1',
    '-f', 'lavfi',
    '-i', 'testsrc=s=320x180:r=25:d=3',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[outv]',
    '-map', '[outv]',
    '-c:v', 'libx264',
    fixturePath,
  ], { maxBuffer: 16 * 1024 * 1024 })

  const probe = await analyzeVideoTechnicalQualityFile(fixturePath)
  assert.equal(probe.hasVideoStream, true)
  assert.ok(probe.measuredDurationMs != null && Math.abs(probe.measuredDurationMs - 4000) <= 100)
  assert.ok(probe.blackFrameRatio != null && probe.blackFrameRatio >= 0.20 && probe.blackFrameRatio <= 0.30)
  console.log(JSON.stringify({ ok: true, probe }))
} finally {
  await rm(fixtureDir, { recursive: true, force: true })
}
