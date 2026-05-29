import fs from 'fs'
import path from 'path'
import { realTextClient } from '@/lib/api-clients/text'
import { loadPromptTemplate } from '@/lib/prompts'

const RESULTS_DIR = path.join(process.cwd(), '.kimi', 'api-test-results')

function saveResult(name: string, data: any) {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const filePath = path.join(RESULTS_DIR, `${name}_${Date.now()}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  console.log(`[Test] Saved: ${filePath}`)
}

async function testTemplate(templateName: string, variables: Record<string, string>, apiType: 'text' | 'image') {
  console.log(`\n=== Testing ${templateName} ===`)
  try {
    const prompt = loadPromptTemplate(templateName, variables)
    const start = Date.now()
    let result: any

    if (apiType === 'text') {
      const text = await realTextClient.generate(prompt, { maxTokens: 2048 })
      result = { preview: text.slice(0, 800) }
    } else {
      // 图像测试跳过（R2 配置占位符）
      result = { skipped: 'R2 storage not configured' }
    }

    const duration = Date.now() - start
    saveResult(`${apiType}_${templateName}`, { success: true, duration, ...result })
    console.log(`[${templateName}] OK (${duration}ms)`)
  } catch (e: any) {
    saveResult(`${apiType}_${templateName}`, { success: false, error: e.message })
    console.log(`[${templateName}] FAILED: ${e.message}`)
  }
}

async function testStoryboardSplit(frameworkStr: string) {
  console.log('\n=== Testing Split Storyboard (3 Acts) ===\n')
  const startTime = Date.now()
  const results = {
    act1: null as any,
    act2: null as any,
    act3: null as any,
    merged: null as any,
    totalDuration: 0,
  }

  try {
    // 测试第一幕
    console.log('[1/3] Testing Act 1...')
    const start1 = Date.now()
    const prompt1 = loadPromptTemplate('storyboard-act1', { USER_INPUT: frameworkStr })
    const text1 = await realTextClient.generate(prompt1, { temperature: 0.7, maxTokens: 4096 })
    const shots1 = JSON.parse(text1)
    results.act1 = {
      success: true,
      duration: Date.now() - start1,
      shotCount: shots1?.length || 0,
    }
    console.log(`✓ Act 1: ${results.act1.shotCount} shots (${results.act1.duration}ms)`)

    // 测试第二幕
    console.log('[2/3] Testing Act 2...')
    const start2 = Date.now()
    const prompt2 = loadPromptTemplate('storyboard-act2', { USER_INPUT: frameworkStr })
    const text2 = await realTextClient.generate(prompt2, { temperature: 0.7, maxTokens: 4096 })
    const shots2 = JSON.parse(text2)
    results.act2 = {
      success: true,
      duration: Date.now() - start2,
      shotCount: shots2?.length || 0,
    }
    console.log(`✓ Act 2: ${results.act2.shotCount} shots (${results.act2.duration}ms)`)

    // 测试第三幕
    console.log('[3/3] Testing Act 3...')
    const start3 = Date.now()
    const prompt3 = loadPromptTemplate('storyboard-act3', { USER_INPUT: frameworkStr })
    const text3 = await realTextClient.generate(prompt3, { temperature: 0.7, maxTokens: 4096 })
    const shots3 = JSON.parse(text3)
    results.act3 = {
      success: true,
      duration: Date.now() - start3,
      shotCount: shots3?.length || 0,
    }
    console.log(`✓ Act 3: ${results.act3.shotCount} shots (${results.act3.duration}ms)`)

    // 合并结果
    const allShots = [...(shots1 || []), ...(shots2 || []), ...(shots3 || [])]
    results.merged = {
      success: true,
      totalShots: allShots.length,
      shots: allShots,
    }
    results.totalDuration = Date.now() - startTime

    console.log(`\n✓ Total: ${allShots.length} shots merged in ${results.totalDuration}ms`)

    return results
  } catch (e: any) {
    results.totalDuration = Date.now() - startTime
    results.merged = {
      success: false,
      error: e.message,
    }
    console.log(`✗ Failed: ${e.message}`)
    return results
  }
}

async function main() {
  console.log('Starting Final API + Prompt Template Tests...')
  console.log('MOCK_MODE:', process.env.MOCK_MODE)
  const overallStart = Date.now()

  // 测试文本模板
  await testTemplate('ideation', { USER_INPUT: '赛博朋克剑客在雨夜霓虹中复仇的故事' }, 'text')
  await testTemplate('style', { USER_INPUT: JSON.stringify({ visualStyle: 'cyberpunk noir', background: 'future Tokyo' }) }, 'text')
  await testTemplate('character', { USER_INPUT: JSON.stringify({ title: '赛博剑客', characters: [{ name: 'Akira', description: 'a cyber-samurai' }] }) }, 'text')
  await testTemplate('review-consistency', { USER_INPUT: '镜头1: 剑客站在雨中\n镜头2: 剑客拔刀' }, 'text')

  // 测试分拆的 storyboard
  const testFramework = JSON.stringify({
    title: '测试影片',
    acts: [
      { actNumber: 1, scenes: ['场景1', '场景2'] },
      { actNumber: 2, scenes: ['场景3', '场景4'] },
      { actNumber: 3, scenes: ['场景5', '场景6'] },
    ],
    characters: [
      { id: 'char_001', name: '主角A', role: '主角', description: '故事的核心人物' },
    ],
  })
  const storyboardResult = await testStoryboardSplit(testFramework)
  saveResult('text_storyboard_split', storyboardResult)

  const overallDuration = Date.now() - overallStart
  console.log(`\n=== Overall Summary ===`)
  console.log(`Total Duration: ${(overallDuration / 1000).toFixed(1)}s`)
  console.log(`Storyboard: ${storyboardResult.merged?.success ? '✓' : '✗'} ${storyboardResult.merged?.totalShots || 0} shots`)
  console.log('\nDone. Check .kimi/api-test-results/')
}

main().catch(console.error)
