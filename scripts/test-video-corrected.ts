/**
 * [VIDEO-TEST-V2] 视频模型测试脚本（修正版）
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/test-video-corrected.ts --yes     # 真实测试
 *   npx tsx --env-file=.env.local scripts/test-video-corrected.ts           # dry-run（默认）
 *
 * 修正说明：
 * - Veo/即梦共用 POST /v1/video/create（而非 /v1/videos/generations）
 * - 模型名使用供应商端真实名
 * - 图片先上传到 R2 获取公网 URL，再传入 API
 * - Hailuo 复用已有 submitHailuoVideo + pollHailuoTask
 */

import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

import {
  submitHailuoVideo,
  pollHailuoTask,
  resolveImageToBase64,
  uploadBufferToR2,
} from '@/lib/api-clients/xiaomi'

// ==================== 配置 ====================
const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

const CONFIRMED = process.argv.includes('--yes') || process.env.VIDEO_TEST_CONFIRM === '1'

const TEST_PROMPT =
  'A cinematic camera movement from the first frame composition to the second frame composition, maintaining consistent lighting and color grading'

// 测试图片（本地路径）
const FIRST_FRAME_PATH = 'public/mock-storage/projects/temp/concepts/concept_1778157832196.png'
const LAST_FRAME_PATH = 'public/mock-storage/projects/temp/concepts/concept_1778157884110.png'

// ==================== 类型 ====================
interface TestResult {
  model: string
  route: string
  mode: 'first-last' | 'first-only'
  success: boolean
  videoUrl?: string
  duration?: number
  error?: string
  stage?: string
}

// ==================== 工具函数 ====================
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 上传图片到 R2 获取公网 URL */
async function uploadImageToR2(filePath: string, name: string): Promise<string> {
  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const filename = `${name}${ext || '.png'}`
  const { url } = await uploadBufferToR2('temp', 'video-test', filename, buffer, 3600)
  return url
}

/** 通用 fetch 带超时 */
async function fetchWithAuth(url: string, options: RequestInit = {}, timeoutMs = 60000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
    clearTimeout(id)
    return res
  } catch (e) {
    clearTimeout(id)
    throw e
  }
}

// ==================== Veo / 即梦 测试（共用 /v1/video/create）====================
async function testVeoJimeng(
  modelId: string,
  firstFrameUrl: string,
  lastFrameUrl?: string
): Promise<TestResult> {
  const isVeo = modelId.startsWith('veo')
  const provider = isVeo ? 'Google' : '即梦'
  console.log(`\n[VIDEO-TEST-V2] ==================== 测试 ${provider} ${modelId} ====================`)

  const result: TestResult = {
    model: modelId,
    route: '/v1/video/create',
    mode: lastFrameUrl ? 'first-last' : 'first-only',
    success: false,
  }

  if (!CONFIRMED) {
    console.log(`[VIDEO-TEST-V2] [DRY-RUN] ${modelId} 测试跳过`)
    result.error = 'dry-run'
    return result
  }

  const images = [firstFrameUrl]
  if (lastFrameUrl) images.push(lastFrameUrl)

  const body: Record<string, any> = {
    model: modelId,
    prompt: TEST_PROMPT,
    images,
    aspect_ratio: '16:9',
    enable_upsample: isVeo ? true : undefined,
    enhance_prompt: isVeo ? true : undefined,
    size: !isVeo ? '720P' : undefined,
  }

  // 清理 undefined
  const cleanedBody = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))

  const start = Date.now()
  try {
    // 1. Submit
    console.log(`[VIDEO-TEST-V2] ${modelId} → POST ${BASE_URL}/v1/video/create`)
    console.log(`[VIDEO-TEST-V2] Body:`, JSON.stringify(cleanedBody).slice(0, 300))

    const submitRes = await fetchWithAuth(`${BASE_URL}/v1/video/create`, {
      method: 'POST',
      body: JSON.stringify(cleanedBody),
    })

    const submitText = await submitRes.text()
    console.log(`[VIDEO-TEST-V2] ${modelId} Submit ← ${submitRes.status}`, submitText.slice(0, 500))

    if (!submitRes.ok) {
      result.error = `Submit ${submitRes.status}: ${submitText.slice(0, 200)}`
      result.stage = 'submit'
      console.log(`[VIDEO-TEST-V2] ${modelId} ❌ Submit 失败`)
      return result
    }

    let submitData: any
    try {
      submitData = JSON.parse(submitText)
    } catch {
      result.error = `Submit 返回非 JSON: ${submitText.slice(0, 200)}`
      result.stage = 'submit'
      return result
    }

    const taskId = submitData?.id || submitData?.task_id || submitData?.data?.id
    if (!taskId) {
      result.error = `Submit 响应缺少 id: ${submitText.slice(0, 200)}`
      result.stage = 'submit'
      return result
    }

    console.log(`[VIDEO-TEST-V2] ${modelId} Task ID: ${taskId}`)

    // 2. Poll
    let lastStatus = ''
    for (let i = 0; i < 60; i++) {
      await sleep(5000)

      // 轮询接口（按优先级尝试）
      const queryUrls = [
        `${BASE_URL}/v1/videos/${encodeURIComponent(taskId)}`,
        `${BASE_URL}/v1/video/query?id=${encodeURIComponent(taskId)}`,
      ]

      for (const queryUrl of queryUrls) {
        try {
          const queryRes = await fetchWithAuth(queryUrl, { method: 'GET' }, 30000)
          if (!queryRes.ok) continue

          const queryText = await queryRes.text()
          let queryData: any
          try {
            queryData = JSON.parse(queryText)
          } catch {
            continue
          }

          const status = (queryData?.status || queryData?.task_status || queryData?.data?.status || '').toLowerCase()
          const videoUrl =
            queryData?.video_url ||
            queryData?.url ||
            queryData?.output_url ||
            queryData?.data?.video_url ||
            queryData?.data?.url

          if (status !== lastStatus) {
            lastStatus = status
            console.log(`[VIDEO-TEST-V2] ${modelId} 状态: ${status}${videoUrl ? ' (有URL)' : ''}`)
          }

          if (videoUrl && ['completed', 'success', 'succeeded', 'done', 'finished'].includes(status)) {
            result.success = true
            result.videoUrl = videoUrl
            result.duration = (Date.now() - start) / 1000
            console.log(`[VIDEO-TEST-V2] ${modelId} ✅ 成功！耗时 ${result.duration.toFixed(1)}s`)
            return result
          }

          if (status === 'failed' || status === 'error') {
            result.error = `Task failed: ${JSON.stringify(queryData).slice(0, 300)}`
            result.stage = 'processing'
            console.log(`[VIDEO-TEST-V2] ${modelId} ❌ 任务失败`)
            return result
          }

          // 有效响应，跳出 URL 循环
          break
        } catch (err: any) {
          // 继续尝试下一个 URL
        }
      }
    }

    result.error = '轮询超时（5分钟）'
    result.stage = 'timeout'
    console.log(`[VIDEO-TEST-V2] ${modelId} ⏱️ 超时`)
  } catch (err: any) {
    result.error = `异常: ${err?.message || String(err)}`
    result.stage = 'exception'
    console.log(`[VIDEO-TEST-V2] ${modelId} ❌ 异常: ${result.error}`)
  }

  return result
}

// ==================== Hailuo 测试（复用已有函数）====================
async function testHailuo(firstFrameUrl: string, lastFrameUrl?: string): Promise<TestResult> {
  console.log(`\n[VIDEO-TEST-V2] ==================== 测试 Hailuo (MiniMax-Hailuo-02) ====================`)
  const result: TestResult = {
    model: 'MiniMax-Hailuo-02',
    route: '/minimax/v1/video_generation',
    mode: lastFrameUrl ? 'first-last' : 'first-only',
    success: false,
  }

  if (!CONFIRMED) {
    console.log(`[VIDEO-TEST-V2] [DRY-RUN] Hailuo 测试跳过`)
    result.error = 'dry-run'
    return result
  }

  const start = Date.now()
  try {
    const { taskId } = await submitHailuoVideo({
      model: 'MiniMax-Hailuo-02',
      prompt: TEST_PROMPT,
      imageUrl: firstFrameUrl,
      lastFrameImageUrl: lastFrameUrl,
      duration: 5,
      resolution: '1080P',
    })

    console.log(`[VIDEO-TEST-V2] Hailuo 提交成功 taskId=${taskId}，开始轮询...`)
    const videoUrl = await pollHailuoTask(taskId, 300, 5000)

    result.success = true
    result.videoUrl = videoUrl
    result.duration = (Date.now() - start) / 1000
    console.log(`[VIDEO-TEST-V2] Hailuo ✅ 成功！耗时 ${result.duration.toFixed(1)}s`)
  } catch (err: any) {
    result.error = `${err?.message || String(err)}`
    result.stage = 'exception'
    console.log(`[VIDEO-TEST-V2] Hailuo ❌ 失败: ${result.error}`)
  }

  return result
}

// ==================== 报告生成 ====================
function generateReport(results: TestResult[]): string {
  const now = new Date().toISOString()
  const usable = results.filter((r) => r.success && r.mode === 'first-last')
  const firstOnly = results.filter((r) => r.success && r.mode === 'first-only')

  return `# 视频模型测试报告 V2（修正版）

## 测试时间：${now}
## 测试方法：POST /v1/video/create（Veo/即梦）+ /minimax/v1/video_generation（Hailuo）

| 模型 | 路由 | 测试模式 | 结果 | 耗时 | 错误 |
|:---|:---|:---|:---|:---|:---|
${results.map((r) => `| ${r.model} | ${r.route} | ${r.mode} | ${r.success ? '✅' : '❌'} | ${r.duration ? r.duration.toFixed(1) + 's' : '-'} | ${r.error || '-'} |`).join('\n')}

## 结论
- 首尾帧支持：${usable.length} 个
- 仅首帧支持：${firstOnly.length} 个
- 失败：${results.filter((r) => !r.success).length} 个

## 建议接入的模型
${usable.length > 0 ? usable.map((r) => `- \`${r.model}\` — 支持首尾帧`).join('\n') : '暂无'}
${firstOnly.length > 0 ? firstOnly.map((r) => `- \`${r.model}\` — 仅支持首帧`).join('\n') : ''}
`
}

// ==================== 主函数 ====================
async function main() {
  console.log('[VIDEO-TEST-V2] ==========================================')
  console.log('[VIDEO-TEST-V2] 视频模型测试 V2（修正版）')
  console.log('[VIDEO-TEST-V2] Veo/即梦: POST /v1/video/create')
  console.log('[VIDEO-TEST-V2] Hailuo: POST /minimax/v1/video_generation')
  console.log('[VIDEO-TEST-V2] ==========================================')

  if (!CONFIRMED) {
    console.log('[VIDEO-TEST-V2] ⚠️ 当前为 dry-run 模式，不会发送真实请求。')
    console.log('[VIDEO-TEST-V2] 如需真实测试，请添加 --yes 参数')
  } else {
    console.log('[VIDEO-TEST-V2] ✅ 已确认，开始真实测试')
    if (!API_KEY) {
      console.error('[VIDEO-TEST-V2] ❌ XIAOMI_API_KEY 未配置')
      process.exit(1)
    }
  }

  // 检查测试图片
  if (!fs.existsSync(FIRST_FRAME_PATH) || !fs.existsSync(LAST_FRAME_PATH)) {
    console.error('[VIDEO-TEST-V2] ❌ 测试图片不存在')
    process.exit(1)
  }

  // 上传图片到 R2 获取公网 URL
  let firstFrameUrl: string
  let lastFrameUrl: string

  if (CONFIRMED) {
    console.log('[VIDEO-TEST-V2] 正在上传测试图片到 R2...')
    try {
      firstFrameUrl = await uploadImageToR2(FIRST_FRAME_PATH, 'first')
      lastFrameUrl = await uploadImageToR2(LAST_FRAME_PATH, 'last')
      console.log(`[VIDEO-TEST-V2] 首帧 URL: ${firstFrameUrl.slice(0, 80)}...`)
      console.log(`[VIDEO-TEST-V2] 尾帧 URL: ${lastFrameUrl.slice(0, 80)}...`)
    } catch (err: any) {
      console.warn(`[VIDEO-TEST-V2] R2 上传失败，回退到 Base64 data URL: ${err?.message}`)
      firstFrameUrl = await resolveImageToBase64(FIRST_FRAME_PATH)
      lastFrameUrl = await resolveImageToBase64(LAST_FRAME_PATH)
      console.log(`[VIDEO-TEST-V2] 首帧 Base64: ${firstFrameUrl.slice(0, 80)}...`)
      console.log(`[VIDEO-TEST-V2] 尾帧 Base64: ${lastFrameUrl.slice(0, 80)}...`)
    }
  } else {
    // dry-run 用占位符
    firstFrameUrl = 'http://placeholder/first.png'
    lastFrameUrl = 'http://placeholder/last.png'
  }

  const results: TestResult[] = []

  // 1. Veo 3.1 fast（首尾帧）
  await sleep(1000)
  const veo31FastResult = await testVeoJimeng('veo3.1-fast', firstFrameUrl, lastFrameUrl)
  results.push(veo31FastResult)

  // 2. Veo 3.1 pro（首尾帧）
  await sleep(10000)
  const veo31ProResult = await testVeoJimeng('veo3.1-pro', firstFrameUrl, lastFrameUrl)
  results.push(veo31ProResult)

  // 3. Veo 2 fast frames（首尾帧）
  await sleep(10000)
  const veo2Result = await testVeoJimeng('veo2-fast-frames', firstFrameUrl, lastFrameUrl)
  results.push(veo2Result)

  // 4. 即梦 jimeng-video-3.0（首尾帧）
  await sleep(10000)
  const jimengResult = await testVeoJimeng('jimeng-video-3.0', firstFrameUrl, lastFrameUrl)
  results.push(jimengResult)

  // 如果即梦首尾帧失败，试单首帧
  if (!jimengResult.success && jimengResult.mode === 'first-last' && CONFIRMED) {
    console.log('[VIDEO-TEST-V2] 即梦首尾帧失败，尝试单首帧...')
    await sleep(10000)
    const jimengFirstOnly = await testVeoJimeng('jimeng-video-3.0', firstFrameUrl, undefined)
    jimengFirstOnly.mode = 'first-only'
    results.push(jimengFirstOnly)
  }

  // 5. Hailuo（首尾帧，复用已有函数）
  await sleep(10000)
  const hailuoResult = await testHailuo(firstFrameUrl, lastFrameUrl)
  results.push(hailuoResult)

  // 生成报告
  const report = generateReport(results)
  const reportPath = '.kimi/video-model-test-report-v2.md'
  fs.writeFileSync(reportPath, report, 'utf-8')
  console.log(`\n[VIDEO-TEST-V2] 报告已生成: ${reportPath}`)

  // 打印摘要
  console.log('\n[VIDEO-TEST-V2] ========== 测试摘要 ==========')
  for (const r of results) {
    const icon = r.success ? '✅' : r.error === 'dry-run' ? '⏸️' : '❌'
    console.log(
      `[VIDEO-TEST-V2] ${r.model} ${icon} ${r.mode} ${r.duration ? r.duration.toFixed(1) + 's' : ''}${r.error && r.error !== 'dry-run' ? ' | ' + r.error.slice(0, 80) : ''}`
    )
  }
  console.log('[VIDEO-TEST-V2] ==================================')
}

main().catch((e) => {
  console.error('[VIDEO-TEST-V2] 异常:', e)
  process.exit(1)
})
