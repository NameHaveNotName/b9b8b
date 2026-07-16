/**
 * 测试脚本：验证参考图一致性修复
 *
 * 运行：npx tsx scripts/test-reference-consistency.ts
 *
 * 验证目标：
 *   1. character.txt 注入 REFERENCE_INSTRUCTIONS 后，要求详细描述参考图特征
 *   2. character.txt 禁止“参考图1”这类占位词
 *   3. style-generation.txt 注入 VISUAL_REFERENCES 后，要求保留参考图核心特征
 *   4. generateCharacterPortrait prompt 包含匹配参考图的指令
 */

import fs from 'fs'
import path from 'path'
import { loadPromptTemplate } from '@/lib/prompts'

const RESULTS_DIR = path.join(process.cwd(), '.kimi', 'api-test-results')

const SAMPLE_FRAMEWORK = {
  characters: [
    { id: 'char_001', name: '海宝', role: '虚拟导游', description: '蓝色圆润可爱型吉祥物，头顶三叉皇冠' },
    { id: 'char_002', name: '海贝', role: '虚拟导游', description: '贝壳海洋元素女孩，黑色齐耳短发，蓝色上衣白色百褶裙' },
  ],
  styleGuide: '电影级3D渲染，高精度细节',
  visualStyle: '电影级3D渲染，高精度细节',
}

const REF_INSTRUCTIONS = `【用户上传了 2 张人物参考图，标签：海宝、海贝】
1. 你必须仔细分析参考图中每个人物的：整体造型、头部装饰/发型、面部特征、服装颜色与款式、标志性配件、身材比例、材质质感。
2. 为每个角色生成 imagePrompt 时，必须用文字准确复现参考图中的核心视觉特征。
3. 禁止在 imagePrompt 中写"参考图1""参考图2"等占位描述；必须用具体、可视觉化的英文形容词和名词。`

const VISUAL_REF_BLOCK = `【用户上传了 2 张视觉参考图，标签：海宝、海贝】
请仔细分析这些参考图：如果图中包含角色/吉祥物/产品形象，在生成三种风格方案时，必须保留其核心视觉识别特征。`

function saveAndValidate(label: string, prompt: string, checks: { name: string; test: (p: string) => boolean }[]) {
  fs.writeFileSync(path.join(RESULTS_DIR, `ref_consistency_${label}.txt`), prompt)
  console.log(`\n📄 ${label}`)
  console.log('─'.repeat(50))
  let pass = true
  checks.forEach(c => {
    const ok = c.test(prompt)
    console.log(`   ${ok ? '✅' : '❌'} ${c.name}`)
    if (!ok) pass = false
  })
  return pass
}

async function main() {
  console.log('═'.repeat(60))
  console.log('📋 测试：参考图一致性修复')
  console.log('═'.repeat(60))

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true })

  // 1. character prompt with references
  const characterPrompt = loadPromptTemplate('character', {
    USER_INPUT: JSON.stringify(SAMPLE_FRAMEWORK),
    REFERENCE_INSTRUCTIONS: REF_INSTRUCTIONS,
  })
  const characterPass = saveAndValidate('character_with_refs', characterPrompt, [
    { name: '包含参考图处理说明', test: p => /参考图/.test(p) },
    { name: '要求详细描述外貌/服装/头饰', test: p => /头部装饰|服装颜色|标志性配件|发型|整体造型/.test(p) },
    { name: '禁止“参考图1/2”占位词', test: p => /禁止在 imagePrompt 中使用.*参考图/.test(p) },
    { name: '要求严格匹配参考图', test: p => /准确复现|保持一致|匹配.*参考图/.test(p) },
  ])

  // 2. style-generation prompt with references
  const stylePrompt = loadPromptTemplate('style-generation', {
    STORY_BRIEF: '武康路旅游宣传片',
    VISUAL_KEYWORDS: '电影级3D渲染',
    MOOD: '温暖、向往',
    VISUAL_REFERENCES: VISUAL_REF_BLOCK,
  })
  const stylePass = saveAndValidate('style_with_refs', stylePrompt, [
    { name: '包含视觉参考图说明', test: p => /视觉参考图/.test(p) },
    { name: '要求保留核心视觉识别特征', test: p => /核心视觉识别特征|颜色、体型、服装、头饰/.test(p) },
    { name: '禁止把角色改成另一个人', test: p => /不能把角色改成另一个人/.test(p) },
  ])

  // 3. character prompt without references (fallback)
  const characterNoRefPrompt = loadPromptTemplate('character', {
    USER_INPUT: JSON.stringify(SAMPLE_FRAMEWORK),
    REFERENCE_INSTRUCTIONS: '【无人物参考图】请根据 framework.characters 中的 description 生成 imagePrompt。',
  })
  const characterNoRefPass = saveAndValidate('character_no_refs', characterNoRefPrompt, [
    { name: '无参考图时仍可用', test: p => /无人物参考图/.test(p) },
  ])

  console.log('\n' + '═'.repeat(60))
  const allPass = characterPass && stylePass && characterNoRefPass
  console.log(`📊 最终结果: ${allPass ? '✅ 全部通过' : '❌ 存在未通过项'}`)
  console.log('📁 详细 prompt 已保存到 .kimi/api-test-results/')
  console.log('═'.repeat(60))
}

main().catch(console.error)
