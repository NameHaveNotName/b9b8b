import fs from 'fs'
import path from 'path'
import { realTextClient } from '@/lib/api-clients/text'
import { realImageClient } from '@/lib/api-clients/image'
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
      // 图像测试：用 generateConceptScene 作为通用测试
      result = await realImageClient.generateConceptScene(
        'test-project',
        'A cyberpunk samurai in neon rain, atmospheric depth',
        'cinematic film still, 35mm Kodak Portra 400',
        []
      )
    }

    const duration = Date.now() - start
    saveResult(`${apiType}_${templateName}`, { success: true, duration, ...result })
    console.log(`[${templateName}] OK (${duration}ms)`)
  } catch (e: any) {
    saveResult(`${apiType}_${templateName}`, { success: false, error: e.message })
    console.log(`[${templateName}] FAILED: ${e.message}`)
  }
}

async function main() {
  console.log('Starting API + Prompt Template tests...')
  console.log('MOCK_MODE:', process.env.MOCK_MODE)

  // 测试文本模板
  await testTemplate('ideation', { USER_INPUT: '赛博朋克剑客在雨夜霓虹中复仇的故事' }, 'text')
  await testTemplate('style', { USER_INPUT: JSON.stringify({ visualStyle: 'cyberpunk noir', background: 'future Tokyo' }) }, 'text')
  await testTemplate('character', { USER_INPUT: JSON.stringify({ title: '赛博剑客', characters: [{ name: 'Akira', description: 'a cyber-samurai' }] }) }, 'text')
  await testTemplate('storyboard', { USER_INPUT: JSON.stringify({ title: '测试', acts: [{ actNumber: 1, scenes: ['scene1'] }] }) }, 'text')
  await testTemplate('review-consistency', { USER_INPUT: '镜头1: 剑客站在雨中\n镜头2: 剑客拔刀' }, 'text')

  // 测试图像模板（通过概念图接口间接测试风格）
  await testTemplate('style', { USER_INPUT: JSON.stringify({ visualStyle: 'cyberpunk noir' }) }, 'image')

  console.log('\nDone. Check .kimi/api-test-results/')
}

main().catch(console.error)
