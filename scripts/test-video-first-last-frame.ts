/**
 * [VIDEO-ROUTE-FIX] 视频模型首尾帧能力测试脚本（修正版）
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/test-video-first-last-frame.ts --yes     # 真实测试
 *   npx tsx --env-file=.env.local scripts/test-video-first-last-frame.ts           # dry-run（默认）
 *
 * 修正说明：
 * - 不复用错误的 /v1/videos/generations 同步路由
 * - 复用 lib/api-clients/xiaomi.ts 中已有的异步任务协议函数
 * - Hailuo 优先测试（供应商日志确认有消费记录）
 * - Veo 503 渠道未开通，暂时跳过
 * - 模型名使用供应商端真实名（如 MiniMax-Hailuo-02）
 */

import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

// 加载 .env.local
config({ path: path.join(process.cwd(), '.env.local') })

// 复用项目中已有的视频生成函数
import {
  submitHailuoVideo,
  pollHailuoTask,
  submitJimengVideo,
  pollJimengTask,
  resolveImageToBase64,
} from '@/lib/api-clients/xiaomi'

// ==================== 配置 ====================
const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

// 测试确认守卫
const CONFIRMED = process.argv.includes('--yes') || process.env.VIDEO_TEST_CONFIRM === '1'

// 测试提示词
const TEST_PROMPT =
  'A cinematic shot, camera slowly moves from the first frame composition to the second frame composition, maintaining consistent lighting and color grading'

// 测试图片（从 public/mock-storage/ 取两张概念图）
const FIRST_FRAME_PATH = 'public/mock-storage/projects/temp/concepts/concept_1778157832196.png'
const LAST_FRAME_PATH = 'public/mock-storage/projects/temp/concepts/concept_1778157884110.png'

// ==================== 测试结果类型 ====================
interface TestResult {
  model: string
  modeA_firstLast: boolean
  modeB_firstOnly: boolean
  error?: string
  videoUrl?: string
  duration?: number
  recommendation: 'usable' | 'first-only' | 'unavailable'
}

// ==================== 测试工具 ====================
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function toBase64(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }
  const mime = mimeMap[ext] || 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

// ==================== Hailuo 测试 ====================
async function testHailuo(firstFramePath: string, lastFramePath: string): Promise<TestResult> {
  console.log('\n[VIDEO-ROUTE-FIX] ==================== 测试 Hailuo (MiniMax-Hailuo-02) ====================')
  const result: TestResult = {
    model: 'MiniMax-Hailuo-02',
    modeA_firstLast: false,
    modeB_firstOnly: false,
    recommendation: 'unavailable',
  }

  if (!CONFIRMED) {
    console.log('[VIDEO-ROUTE-FIX] [DRY-RUN] Hailuo 测试跳过')
    result.error = 'dry-run'
    return result
  }

  // 模式 A：首尾帧
  console.log('[VIDEO-ROUTE-FIX] Hailuo 模式 A：首尾帧 + 提示词')
  const startA = Date.now()
  try {
    const { taskId } = await submitHailuoVideo({
      model: 'MiniMax-Hailuo-02',
      prompt: TEST_PROMPT,
      imageUrl: firstFramePath,
      lastFrameImageUrl: lastFramePath,
      duration: 5,
      resolution: '1080P',
    })
    console.log(`[VIDEO-ROUTE-FIX] Hailuo 提交成功 taskId=${taskId}，开始轮询...`)
    const videoUrl = await pollHailuoTask(taskId, 300, 5000)
    result.modeA_firstLast = true
    result.videoUrl = videoUrl
    result.duration = (Date.now() - startA) / 1000
    result.recommendation = 'usable'
    console.log(`[VIDEO-ROUTE-FIX] Hailuo 模式 A ✅ 成功！耗时 ${result.duration.toFixed(1)}s`)
    console.log(`[VIDEO-ROUTE-FIX] 视频 URL: ${videoUrl.slice(0, 80)}...`)
    return result
  } catch (err: any) {
    result.error = `模式A失败: ${err?.message || String(err)}`
    console.log(`[VIDEO-ROUTE-FIX] Hailuo 模式 A ❌ 失败: ${result.error}`)
  }

  // 模式 B：仅首帧（兜底）
  console.log('[VIDEO-ROUTE-FIX] Hailuo 模式 B：仅首帧 + 提示词')
  const startB = Date.now()
  try {
    const { taskId } = await submitHailuoVideo({
      model: 'MiniMax-Hailuo-02',
      prompt: TEST_PROMPT,
      imageUrl: firstFramePath,
      duration: 5,
      resolution: '1080P',
    })
    console.log(`[VIDEO-ROUTE-FIX] Hailuo 模式 B 提交成功 taskId=${taskId}，开始轮询...`)
    const videoUrl = await pollHailuoTask(taskId, 300, 5000)
    result.modeB_firstOnly = true
    result.videoUrl = videoUrl
    result.duration = (Date.now() - startB) / 1000
    result.recommendation = 'first-only'
    console.log(`[VIDEO-ROUTE-FIX] Hailuo 模式 B ✅ 成功！耗时 ${result.duration.toFixed(1)}s`)
    return result
  } catch (err: any) {
    console.log(`[VIDEO-ROUTE-FIX] Hailuo 模式 B ❌ 失败: ${err?.message || String(err)}`)
  }

  result.error = result.error || 'Hailuo 所有模式失败'
  return result
}

// ==================== Jimeng 测试 ====================
async function testJimeng(firstFramePath: string): Promise<TestResult> {
  console.log('\n[VIDEO-ROUTE-FIX] ==================== 测试 Jimeng（即梦）====================')
  const result: TestResult = {
    model: 'jimeng-video',
    modeA_firstLast: false,
    modeB_firstOnly: false,
    recommendation: 'unavailable',
  }

  if (!CONFIRMED) {
    console.log('[VIDEO-ROUTE-FIX] [DRY-RUN] Jimeng 测试跳过')
    result.error = 'dry-run'
    return result
  }

  // Jimeng 只支持 image_url（单首帧），尝试探测 last_frame_image
  console.log('[VIDEO-ROUTE-FIX] Jimeng：仅支持 image_url（单首帧），尝试提交...')
  const start = Date.now()
  try {
    // Jimeng 需要 http(s) URL，本地路径需要转为公网可访问的 URL
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
    const imageUrl = `${baseUrl}/mock-storage/projects/temp/concepts/concept_1778157832196.png`

    const { taskId } = await submitJimengVideo({
      prompt: TEST_PROMPT,
      imageUrl,
      duration: 5,
      aspectRatio: '16:9',
    })
    console.log(`[VIDEO-ROUTE-FIX] Jimeng 提交成功 taskId=${taskId}，开始轮询...`)
    const videoUrl = await pollJimengTask(taskId, 300, 5000)
    result.modeB_firstOnly = true
    result.videoUrl = videoUrl
    result.duration = (Date.now() - start) / 1000
    result.recommendation = 'first-only'
    console.log(`[VIDEO-ROUTE-FIX] Jimeng ✅ 成功！耗时 ${result.duration.toFixed(1)}s`)
    return result
  } catch (err: any) {
    result.error = `Jimeng 失败: ${err?.message || String(err)}`
    console.log(`[VIDEO-ROUTE-FIX] Jimeng ❌ 失败: ${result.error}`)
  }

  return result
}

// ==================== 报告生成 ====================
function generateReport(results: TestResult[]): string {
  const now = new Date().toISOString().split('T')[0]
  const usable = results.filter((r) => r.recommendation === 'usable')
  const firstOnly = results.filter((r) => r.recommendation === 'first-only')

  return `# 视频模型首尾帧测试报告（修正版）

## 测试时间：${now}
## 测试方法：复用异步任务协议（submit → poll）

| 模型 | 首尾帧支持 | 首帧支持 | 推荐度 | 错误 |
|:---|:---|:---|:---|:---|
${results.map((r) => `| ${r.model} | ${r.modeA_firstLast ? '✅' : '❌'} | ${r.modeB_firstOnly ? '✅' : '❌'} | ${r.recommendation === 'usable' ? '⭐⭐⭐⭐⭐' : r.recommendation === 'first-only' ? '⭐⭐⭐' : '❌'} | ${r.error || '-'} |`).join('\n')}

## 结论
- 完全支持首尾帧的模型：${usable.length} 个
- 仅支持首帧的模型：${firstOnly.length} 个
- 完全不支持的模型：${results.filter((r) => r.recommendation === 'unavailable').length} 个

## 建议接入网站的模型
${usable.length > 0 ? usable.map((r) => `- \`${r.model}\` — 支持首尾帧`).join('\n') : '暂无'}
${firstOnly.length > 0 ? firstOnly.map((r) => `- \`${r.model}\` — 仅支持首帧`).join('\n') : ''}
`
}

// ==================== 主函数 ====================
async function main() {
  console.log('[VIDEO-ROUTE-FIX] ==========================================')
  console.log('[VIDEO-ROUTE-FIX] 视频模型首尾帧能力测试（修正版）')
  console.log('[VIDEO-ROUTE-FIX] 复用 lib/api-clients/xiaomi.ts 异步协议函数')
  console.log('[VIDEO-ROUTE-FIX] ==========================================')

  if (!CONFIRMED) {
    console.log('[VIDEO-ROUTE-FIX] ⚠️ 当前为 dry-run 模式，不会发送真实请求。')
    console.log('[VIDEO-ROUTE-FIX] 如需真实测试，请添加 --yes 参数')
    console.log('[VIDEO-ROUTE-FIX] 命令：npx tsx --env-file=.env.local scripts/test-video-first-last-frame.ts --yes')
  } else {
    console.log('[VIDEO-ROUTE-FIX] ✅ 已确认，开始真实测试')
    if (!API_KEY) {
      console.error('[VIDEO-ROUTE-FIX] ❌ XIAOMI_API_KEY 未配置')
      process.exit(1)
    }
  }

  // 检查测试图片
  if (!fs.existsSync(FIRST_FRAME_PATH) || !fs.existsSync(LAST_FRAME_PATH)) {
    console.error('[VIDEO-ROUTE-FIX] ❌ 测试图片不存在')
    process.exit(1)
  }
  console.log(`[VIDEO-ROUTE-FIX] 首帧图: ${FIRST_FRAME_PATH} ✅`)
  console.log(`[VIDEO-ROUTE-FIX] 尾帧图: ${LAST_FRAME_PATH} ✅`)

  const results: TestResult[] = []

  // 优先测试 Hailuo（供应商日志确认有消费记录）
  const hailuoResult = await testHailuo(FIRST_FRAME_PATH, LAST_FRAME_PATH)
  results.push(hailuoResult)

  // Hailuo 成功后，再测试 Jimeng
  if (hailuoResult.recommendation === 'usable' || hailuoResult.recommendation === 'first-only') {
    await sleep(3000)
    const jimengResult = await testJimeng(FIRST_FRAME_PATH)
    results.push(jimengResult)
  } else {
    console.log('[VIDEO-ROUTE-FIX] Hailuo 未成功，跳过 Jimeng 测试')
  }

  // 生成报告
  const report = generateReport(results)
  const reportPath = '.kimi/video-model-test-report.md'
  fs.writeFileSync(reportPath, report, 'utf-8')
  console.log(`\n[VIDEO-ROUTE-FIX] 报告已生成: ${reportPath}`)

  // 打印摘要
  console.log('\n[VIDEO-ROUTE-FIX] ========== 测试摘要 ==========')
  for (const r of results) {
    console.log(
      `[VIDEO-ROUTE-FIX] ${r.model}: A=${r.modeA_firstLast ? '✅' : '❌'} B=${r.modeB_firstOnly ? '✅' : '❌'} → ${r.recommendation}${r.error ? ' | error=' + r.error.slice(0, 80) : ''}`
    )
  }
  console.log('[VIDEO-ROUTE-FIX] ==================================')
}

main().catch((e) => {
  console.error('[VIDEO-ROUTE-FIX] 异常:', e)
  process.exit(1)
})
