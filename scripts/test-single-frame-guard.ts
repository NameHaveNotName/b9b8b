/**
 * 测试脚本：验证分镜/关键帧生成不会出现分屏/多格/拼贴
 *
 * 运行：npx tsx scripts/test-single-frame-guard.ts
 *
 * 验证目标：
 *   1. storyboard 的 LLM 提示词明确要求单张完整画面，禁止 split-screen/panels/collage
 *   2. keyframe-last 提示词也包含同样约束
 *   3. api-clients 的 generateKeyframe/generateConceptScene 追加 single-frame guard
 */

import fs from 'fs'
import path from 'path'

const RESULTS_DIR = path.join(process.cwd(), '.kimi', 'api-test-results')

const FORBIDDEN_PATTERNS = /split-screen|multi-panel|collage|triptych|diptych|comic layout|timeline|before-and-after|day-night split|panels/i

function checkFile(filePath: string, label: string): { pass: boolean; issues: string[] } {
  const content = fs.readFileSync(filePath, 'utf-8')
  const issues: string[] = []

  if (/Single full frame only|单张完整画面|单一瞬间的单一画面/i.test(content)) {
    issues.push(`✅ ${label} 包含单帧完整画面约束`)
  } else {
    issues.push(`❌ ${label} 缺少单帧完整画面约束`)
  }

  if (FORBIDDEN_PATTERNS.test(content)) {
    issues.push(`✅ ${label} 列出了禁止的分屏/多格/拼贴关键词`)
  } else {
    issues.push(`❌ ${label} 未列出禁止关键词`)
  }

  return { pass: issues.every(i => i.startsWith('✅')), issues }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('📋 测试：单帧画面防切分约束')
  console.log('═'.repeat(60))

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true })

  const checks = [
    { file: 'app/api/projects/[id]/steps/storyboard/route.ts', label: 'storyboard route' },
    { file: 'prompts/keyframe-last.txt', label: 'keyframe-last prompt' },
    { file: 'lib/api-clients/index.ts', label: 'api-clients index' },
  ]

  let allPass = true
  for (const c of checks) {
    const { pass, issues } = checkFile(c.file, c.label)
    console.log(`\n📄 ${c.label}`)
    console.log('─'.repeat(50))
    issues.forEach(i => console.log(`   ${i}`))
    if (!pass) allPass = false
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`📊 最终结果: ${allPass ? '✅ 全部通过' : '❌ 存在未通过项'}`)
  console.log('═'.repeat(60))
}

main().catch(console.error)
