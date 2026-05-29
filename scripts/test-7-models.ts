/**
 * 七模型图像生成测试脚本
 *
 * 用法: npx tsx scripts/test-7-models.ts
 *
 * 对 7 个生图模型各生成一次图片，使用相同提示词和同一张参考图。
 * 输出保存在 test-7-models/ 目录下，每个模型一个文件。
 */

import { generateImage } from '@/lib/api-clients/xiaomi'
import { IMAGE_MODELS } from '@/lib/models-config'
import * as fs from 'fs'
import * as path from 'path'

const OUTPUT_DIR = path.join(process.cwd(), 'test-7-models')

// 测试用提示词（中英文混合，覆盖场景/风格/光影）
const TEST_PROMPT = `Cinematic wide shot, golden hour lighting, a lone samurai standing on a cliff overlooking a misty valley, cherry blossom petals drifting in the wind, atmospheric depth, film grain, 35mm photography style, 8K resolution`

// 测试用参考图（使用项目中的 mock 图片，或者你可以替换为任意 http(s) URL）
// 这里用一个公网测试图
const TEST_REFERENCE_URL = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512&h=512&fit=crop'

// 画面比例
const TEST_ASPECT_RATIO = '16:9'

async function testOneModel(modelId: string, label: string) {
  console.log(`\n========== 开始测试: ${label} (${modelId}) ==========`)
  const startTime = Date.now()

  try {
    const result = await generateImage({
      model: modelId,
      prompt: TEST_PROMPT,
      referenceImageUrl: TEST_REFERENCE_URL,
      aspectRatio: TEST_ASPECT_RATIO,
      watermark: false,
    })

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`✅ ${label} 生成成功 — 耗时: ${elapsed}s, 模型: ${result.model}, isMock: ${!!result.isMock}`)

    // 保存图片
    const safeLabel = label.replace(/[^\w一-鿿]/g, '_')
    const ext = result.isMock ? 'png' : 'png'
    const filename = `${safeLabel}_${modelId}.${ext}`
    const filePath = path.join(OUTPUT_DIR, filename)

    fs.writeFileSync(filePath, result.buffer)
    console.log(`💾 已保存: ${filename} (${(result.buffer.length / 1024).toFixed(1)} KB)`)

    // 保存元信息
    const metaPath = path.join(OUTPUT_DIR, `${safeLabel}_${modelId}.meta.json`)
    fs.writeFileSync(metaPath, JSON.stringify({
      model: result.model,
      prompt: TEST_PROMPT,
      referenceUrl: TEST_REFERENCE_URL,
      aspectRatio: TEST_ASPECT_RATIO,
      isMock: result.isMock,
      lastError: result.lastError,
      revisedPrompt: result.revisedPrompt,
      elapsedSec: elapsed,
      fileSize: result.buffer.length,
      filename,
    }, null, 2))

    return { modelId, label, success: true, isMock: result.isMock, elapsed, filename }
  } catch (err: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error(`❌ ${label} 失败 (${elapsed}s): ${err.message}`)

    // 保存错误记录
    const safeLabel = label.replace(/[^\w一-鿿]/g, '_')
    const errPath = path.join(OUTPUT_DIR, `${safeLabel}_${modelId}.error.txt`)
    fs.writeFileSync(errPath, `Model: ${modelId}\nLabel: ${label}\nError: ${err.message}\nElapsed: ${elapsed}s\n`)

    return { modelId, label, success: false, error: err.message, elapsed }
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('七模型图像生成测试')
  console.log('='.repeat(60))
  console.log(`输出目录: ${OUTPUT_DIR}`)
  console.log(`提示词: ${TEST_PROMPT.slice(0, 80)}...`)
  console.log(`参考图: ${TEST_REFERENCE_URL}`)
  console.log(`比例: ${TEST_ASPECT_RATIO}`)
  console.log(`模型数: ${IMAGE_MODELS.available.length}`)
  console.log('='.repeat(60))

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  const results = []
  const totalStart = Date.now()

  for (const model of IMAGE_MODELS.available) {
    const r = await testOneModel(model.id, model.label)
    results.push(r)
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1)

  // 汇总报告
  console.log('\n' + '='.repeat(60))
  console.log('测试汇总报告')
  console.log('='.repeat(60))

  const successCount = results.filter(r => r.success && !r.isMock).length
  const mockCount = results.filter(r => r.isMock).length
  const failCount = results.filter(r => !r.success).length

  for (const r of results) {
    const icon = r.success && !r.isMock ? '✅' : r.isMock ? '⚠️' : '❌'
    const tag = r.success && !r.isMock ? '成功' : r.isMock ? 'Mock' : '失败'
    console.log(`  ${icon} ${r.label.padEnd(24)} ${tag.padEnd(6)} 耗时 ${(r as any).elapsed || '?'}s  文件: ${(r as any).filename || 'N/A'}`)
  }

  console.log('-'.repeat(60))
  console.log(`总计: 成功=${successCount} | Mock=${mockCount} | 失败=${failCount} | 总耗时=${totalElapsed}s`)
  console.log('='.repeat(60))

  // 生成汇总文件
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify({
      testTime: new Date().toISOString(),
      prompt: TEST_PROMPT,
      referenceUrl: TEST_REFERENCE_URL,
      aspectRatio: TEST_ASPECT_RATIO,
      totalElapsed,
      successCount,
      mockCount,
      failCount,
      results,
    }, null, 2)
  )

  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('脚本异常:', err)
  process.exit(1)
})
