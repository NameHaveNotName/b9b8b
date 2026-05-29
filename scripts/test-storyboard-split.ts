import fs from 'fs'
import path from 'path'
import { realTextClient } from '@/lib/api-clients/text'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'

const RESULTS_DIR = path.join(process.cwd(), '.kimi', 'api-test-results')

function saveResult(name: string, data: any) {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const filePath = path.join(RESULTS_DIR, `${name}_${Date.now()}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  console.log(`[Test] Saved: ${filePath}`)
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
    const shots1 = extractJsonFromMarkdown(text1)
    results.act1 = {
      success: true,
      duration: Date.now() - start1,
      shotCount: shots1?.length || 0,
      shots: shots1,
    }
    console.log(`✓ Act 1: ${results.act1.shotCount} shots (${results.act1.duration}ms)`)

    // 测试第二幕
    console.log('[2/3] Testing Act 2...')
    const start2 = Date.now()
    const prompt2 = loadPromptTemplate('storyboard-act2', { USER_INPUT: frameworkStr })
    const text2 = await realTextClient.generate(prompt2, { temperature: 0.7, maxTokens: 4096 })
    const shots2 = extractJsonFromMarkdown(text2)
    results.act2 = {
      success: true,
      duration: Date.now() - start2,
      shotCount: shots2?.length || 0,
      shots: shots2,
    }
    console.log(`✓ Act 2: ${results.act2.shotCount} shots (${results.act2.duration}ms)`)

    // 测试第三幕
    console.log('[3/3] Testing Act 3...')
    const start3 = Date.now()
    const prompt3 = loadPromptTemplate('storyboard-act3', { USER_INPUT: frameworkStr })
    const text3 = await realTextClient.generate(prompt3, { temperature: 0.7, maxTokens: 4096 })
    const shots3 = extractJsonFromMarkdown(text3)
    results.act3 = {
      success: true,
      duration: Date.now() - start3,
      shotCount: shots3?.length || 0,
      shots: shots3,
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
  console.log('Starting Split Storyboard Tests...')
  console.log('MOCK_MODE:', process.env.MOCK_MODE)

  // 测试框架
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

  const result = await testStoryboardSplit(testFramework)
  saveResult('storyboard_split', result)

  console.log('\nDone. Check .kimi/api-test-results/')
}

main().catch(console.error)
