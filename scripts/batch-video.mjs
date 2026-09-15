#!/usr/bin/env node

/**
 * Batch-submit first-frame videos through the OpenLux Vidu API.
 *
 * Usage:
 *   OPENLUX_API_KEY=... npm run batch:video -- tasks.json
 *
 * Optional environment variables:
 *   OPENLUX_BASE_URL=https://api.openlux.ai
 *   BATCH_VIDEO_CONCURRENCY=2
 *   BATCH_VIDEO_POLL_INTERVAL_MS=5000
 *   BATCH_VIDEO_POLL_TIMEOUT_SEC=240
 *   BATCH_VIDEO_OUTPUT_DIR=output
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const API_KEY = process.env.OPENLUX_API_KEY
const BASE_URL = (process.env.OPENLUX_BASE_URL || 'https://api.openlux.ai').replace(/\/+$/, '')
const CONCURRENCY = readPositiveInteger('BATCH_VIDEO_CONCURRENCY', 2)
const POLL_INTERVAL_MS = readPositiveInteger('BATCH_VIDEO_POLL_INTERVAL_MS', 5_000)
const POLL_TIMEOUT_SEC = readPositiveInteger('BATCH_VIDEO_POLL_TIMEOUT_SEC', 240)
const OUT_DIR = path.resolve(process.env.BATCH_VIDEO_OUTPUT_DIR || 'output')
const RESULTS_PATH = path.join(OUT_DIR, 'results.json')
const RESOLUTIONS = new Set(['540p', '720p', '1080p'])

function readPositiveInteger(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数，当前值：${raw}`)
  }
  return value
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function summarizeImageRef(imageUrl) {
  if (imageUrl.startsWith('data:')) return `${imageUrl.slice(0, 32)}… (${imageUrl.length} chars)`
  return imageUrl.slice(0, 120)
}

function validateTask(task, index) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error(`任务 ${index + 1} 必须是对象`)
  }
  if (typeof task.imageUrl !== 'string' || !task.imageUrl.trim()) {
    throw new Error(`任务 ${index + 1} 缺少 imageUrl`)
  }
  if (!/^(https?:\/\/|data:image\/)/i.test(task.imageUrl)) {
    throw new Error(`任务 ${index + 1} 的 imageUrl 必须是公网 HTTP(S) URL 或 image data URL`)
  }
  if (task.prompt !== undefined && typeof task.prompt !== 'string') {
    throw new Error(`任务 ${index + 1} 的 prompt 必须是字符串`)
  }
  if (task.resolution !== undefined && !RESOLUTIONS.has(task.resolution)) {
    throw new Error(`任务 ${index + 1} 的 resolution 仅支持 540p、720p、1080p`)
  }
  if (task.duration !== undefined && !Number.isFinite(Number(task.duration))) {
    throw new Error(`任务 ${index + 1} 的 duration 必须是数字`)
  }
  if (task.seed !== undefined && !Number.isFinite(Number(task.seed))) {
    throw new Error(`任务 ${index + 1} 的 seed 必须是数字`)
  }
}

async function submit(task, index) {
  const duration = Math.max(1, Math.min(10, Math.round(Number(task.duration ?? 5))))
  const requestBody = {
    model: task.model || 'viduq2-turbo',
    images: [task.imageUrl],
    prompt: (task.prompt || '').slice(0, 2000),
    duration,
    resolution: task.resolution || '720p',
    seed: Math.round(Number(task.seed ?? 0)),
    movement_amplitude: 'auto',
    audio: false,
    off_peak: false,
    watermark: false,
  }

  console.log(`[SUBMIT ${index + 1}]`, summarizeImageRef(task.imageUrl), `duration=${duration}`)
  const response = await fetch(`${BASE_URL}/ent/v2/img2video`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(60_000),
  })

  const text = await response.text()
  if (!response.ok) {
    // 提交失败不自动重试，避免上游已受理但响应中断时重复计费。
    throw new Error(`提交 HTTP ${response.status}: ${text.slice(0, 300)}`)
  }

  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`提交响应不是 JSON: ${text.slice(0, 300)}`)
  }

  const taskId = data?.task_id || data?.id || data?.data?.task_id
  if (!taskId) throw new Error(`提交响应缺少 task_id: ${text.slice(0, 300)}`)
  return String(taskId)
}

async function poll(taskId, index) {
  const deadline = Date.now() + POLL_TIMEOUT_SEC * 1000
  let lastState = ''

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    try {
      const response = await fetch(
        `${BASE_URL}/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
        {
          headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        },
      )
      const text = await response.text()
      if (!response.ok) {
        console.warn(`[POLL ${index + 1}] ${taskId} HTTP ${response.status}`)
        continue
      }

      let data
      try {
        data = JSON.parse(text)
      } catch {
        console.warn(`[POLL ${index + 1}] ${taskId} 返回非 JSON，稍后重试`)
        continue
      }

      const payload = data?.data || data
      const state = String(payload?.state || payload?.status || '').toLowerCase()
      const creations = payload?.creations || data?.creations || []
      const videoUrl =
        creations?.[0]?.url || payload?.url || payload?.video_url || data?.url || data?.video_url

      if (state !== lastState) {
        console.log(`[POLL ${index + 1}] ${taskId} state=${state || 'unknown'} hasUrl=${Boolean(videoUrl)}`)
        lastState = state
      }
      if (state === 'success' && videoUrl) return String(videoUrl)
      if (state === 'failed' || state === 'error') {
        throw new Error(`任务失败 ${taskId}: ${text.slice(0, 300)}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`任务失败 ${taskId}:`)) throw error
      console.warn(`[POLL ${index + 1}] ${taskId} 暂时失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(`任务超时 ${taskId}（>${POLL_TIMEOUT_SEC}s）`)
}

async function download(url, filePath) {
  if (!/^https?:\/\//i.test(url)) throw new Error(`视频结果不是 HTTP(S) URL: ${url.slice(0, 120)}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}: ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0) throw new Error(`下载结果为空: ${url}`)
  await writeFile(filePath, bytes)
  console.log('[DOWNLOAD]', filePath, `(${(bytes.length / 1024 / 1024).toFixed(2)} MB)`)
}

let saveQueue = Promise.resolve()
let saveSequence = 0

function saveResults(results) {
  // 先取快照、再串行写入，避免多个 worker 共用临时文件时相互覆盖。
  const snapshot = `${JSON.stringify(results, null, 2)}\n`
  const sequence = saveSequence
  saveSequence += 1
  const write = saveQueue.then(async () => {
    const temporaryPath = `${RESULTS_PATH}.${process.pid}.${sequence}.tmp`
    await writeFile(temporaryPath, snapshot, 'utf8')
    await rename(temporaryPath, RESULTS_PATH)
  })
  saveQueue = write.catch(() => {})
  return write
}

async function runOne(task, index, results) {
  const startedAt = new Date().toISOString()
  try {
    const taskId = await submit(task, index)
    // 任务号先落盘。即使进程稍后中断，也可据此向供应商追查已提交任务。
    results[index] = { index, status: 'polling', taskId, startedAt }
    await saveResults(results)

    const videoUrl = await poll(taskId, index)
    const fileName = `video_${String(index + 1).padStart(3, '0')}.mp4`
    await download(videoUrl, path.join(OUT_DIR, fileName))
    results[index] = {
      index,
      status: 'ok',
      taskId,
      videoUrl,
      fileName,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[FAIL ${index + 1}]`, message)
    results[index] = {
      index,
      status: 'failed',
      ...(results[index]?.taskId ? { taskId: results[index].taskId } : {}),
      error: message,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
  }
  await saveResults(results)
}

async function main() {
  if (!API_KEY) throw new Error('缺少 OPENLUX_API_KEY；请通过环境变量提供，不要写进任务文件或仓库')

  const inputPath = path.resolve(process.argv[2] || 'tasks.json')
  const tasks = JSON.parse(await readFile(inputPath, 'utf8'))
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('任务文件必须是非空 JSON 数组')
  }
  tasks.forEach(validateTask)

  await mkdir(OUT_DIR, { recursive: true })
  const results = Array.from({ length: tasks.length }, (_, index) => ({ index, status: 'queued' }))
  await saveResults(results)
  console.log(`共 ${tasks.length} 个任务，并发 ${CONCURRENCY}，结果目录：${OUT_DIR}`)

  let cursor = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      await runOne(tasks[index], index, results)
    }
  })
  await Promise.all(workers)

  const ok = results.filter((result) => result.status === 'ok').length
  const failed = results.filter((result) => result.status === 'failed').length
  console.log(`完成：${ok} 成功 / ${failed} 失败；明细：${RESULTS_PATH}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
