/**
 * 测试脚本：验证宣传片/信息驱动型框架生成质量
 *
 * 测试输入：博物馆 CityWalk 一日游路线（用户真实案例）
 *
 * 运行：npx tsx scripts/test-presentation-paradigm.ts
 *
 * 验证目标：
 *   1. characters 是口播主持人/讲解员，不是虚构故事角色
 *   2. acts 是按亮点/主题分组的段落，不是叙事弧线
 *   3. scenes 基于用户输入的实际内容，无编造的虚构互动
 *   4. styleGuide 尊重用户明确提出的视觉风格要求
 */

import fs from 'fs'
import path from 'path'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'

const RESULTS_DIR = path.join(process.cwd(), '.kimi', 'api-test-results')

// ==================== 测试输入 ====================
const MUSEUM_INPUT = `由海宝和海贝全程向镜头介绍旅游路线的优美之处，一定由念白引导，每个镜头都有高密度的语言介绍内容 70%精致3D城市动画＋20%海派生活绘本＋10%自然电影光影。 上午:指定地点集合，步行游览武康路北段一南段一复兴西路，依次参观武康大楼、黄兴旧居(外观)、开普敦公寓、密丹公寓、原意大利总领事馆官邸(外观、良友公寓、玫瑰别墅等。中午:附近餐厅享用午餐。下午:前往上音城堡，参观建筑并享用下午茶。结束后乘车返回。 深入衡复历史文化风貌区，以CityWal方式漫步武康路一复兴西路，沿途欣赏武康大楼、密丹公寓、玫瑰别墅等多栋优秀历史建筑，聆听老洋房背后的名人轶事;中午享用本帮风味午餐;下午走进上音城堡(原犹太俱乐部)，在德国巴伐利亚风格的花园住宅中享用精致下午茶，感受音乐与建筑的交融。全程导游讲解，适合文化爱好者及团队休闲。`

// ==================== 验证规则 ====================
function checkCharacters(framework: any): { pass: boolean; issues: string[] } {
  const issues: string[] = []
  const chars = framework?.characters || []
  if (chars.length === 0) return { pass: false, issues: ['❌ 没有 characters'] }

  const presenterRoles = /讲解员|主持人|导游|导览|吉祥物|主播|介绍人/
  const fictionBg = /曾是|从小|童年|因为|曾经|原本|改行|转行|退役/

  for (const c of chars) {
    if (!presenterRoles.test(c.role || '')) {
      issues.push(`⚠️ "${c.name}" role="${c.role}"，不像口播主持人`)
    }
    if (fictionBg.test(c.description || '')) {
      issues.push(`❌ "${c.name}" description 含虚构背景: "${c.description?.slice(0, 60)}..."`)
    }
  }

  const storyRoles = chars.filter((c: any) => /主角|配角|反派|男主|女主/.test(c.role || ''))
  if (storyRoles.length > 0) {
    issues.push(`❌ 发现故事角色: ${storyRoles.map((c: any) => c.role).join(', ')}`)
  }

  return { pass: issues.every(i => i.startsWith('⚠️')), issues }
}

function checkActs(framework: any): { pass: boolean; issues: string[] } {
  const issues: string[] = []
  const acts = framework?.acts || []
  if (acts.length === 0) return { pass: false, issues: ['❌ 没有 acts'] }

  const storyBeat = /矛盾|冲突|危机|抉择|崩塌|觉醒|蜕变|决战|逃亡|背叛|复仇/
  const infoWord = /介绍|展示|参观|游览|讲解|漫步|探访|享用|感受|体验|打卡/

  for (const act of acts) {
    const title = act.title || ''
    const scenes = act.scenes || []
    if (storyBeat.test(title + scenes.join(' '))) {
      issues.push(`❌ 幕"${title}"包含剧情冲突关键词`)
    }
    if (!infoWord.test(title + scenes.join(' '))) {
      issues.push(`⚠️ 幕"${title}"缺少信息介绍类词汇`)
    }
  }
  return { pass: issues.every(i => i.startsWith('⚠️')), issues }
}

function checkScenes(framework: any): { pass: boolean; issues: string[] } {
  const issues: string[] = []
  const acts = framework?.acts || []

  const inputEntities = [
    '武康路', '复兴西路', '武康大楼', '黄兴旧居', '开普敦公寓',
    '密丹公寓', '意大利总领事馆', '良友公寓', '玫瑰别墅',
    '上音城堡', '巴伐利亚', '下午茶', '本帮', 'CityWalk',
    '衡复', '历史建筑', '老洋房', '海宝', '海贝', '3D', '手绘', '实拍'
  ]

  const fiction = /跑向|拉着|牵起|拥抱|微笑说|转身离开|眼中闪|心里想|默契地|交换.*眼神|凑近|抚摸|依偎|并肩坐/

  let totalScenes = 0, fictionCount = 0, hasInputContent = false

  for (const act of acts) {
    for (const scene of (act.scenes || [])) {
      totalScenes++
      if (fiction.test(scene)) {
        fictionCount++
        issues.push(`❌ 虚构互动: "${scene.slice(0, 80)}..."`)
      }
      if (inputEntities.some(e => scene.includes(e))) hasInputContent = true
    }
  }

  if (totalScenes > 0 && fictionCount > totalScenes * 0.3) {
    issues.push(`❌ ${fictionCount}/${totalScenes} 个场景含虚构互动`)
  }
  if (!hasInputContent) {
    issues.push('⚠️ 场景中未找到用户输入的实际地名')
  }
  return { pass: fictionCount === 0 && issues.length === 0, issues }
}

function checkStyleGuide(framework: any): { pass: boolean; issues: string[] } {
  const issues: string[] = []
  const guide = framework?.styleGuide || ''
  if (!/3D|三维/.test(guide)) issues.push('⚠️ styleGuide 未提及 3D 动画风格')
  if (!/手绘|绘本|插画/.test(guide)) issues.push('⚠️ styleGuide 未提及手绘/绘本风格')
  return { pass: issues.length === 0, issues }
}

function checkCharacterAppearance(framework: any): { pass: boolean; issues: string[] } {
  const issues: string[] = []
  const chars = framework?.characters || []
  if (chars.length === 0) return { pass: false, issues: ['❌ 没有 characters'] }

  // 外观描述关键词（颜色、体型、服装、视觉特征）
  const appearanceWords = /蓝|白|红|黑|绿|黄|圆|胖|瘦|高|矮|大|小|服装|穿着|装饰|花纹|徽章|帽|领|衫|衣|裤|鞋|体型|造型/
  const roleOnlyPattern = /^(风格定位|角色定位)[：:]/

  for (const c of chars) {
    const desc = c.description || ''
    if (roleOnlyPattern.test(desc.trim())) {
      issues.push(`❌ "${c.name}" description 只有角色定位，无外观描述: "${desc.slice(0, 60)}..."`)
    }
    if (!appearanceWords.test(desc)) {
      issues.push(`⚠️ "${c.name}" description 缺失外观关键词（颜色/体型/服装）: "${desc.slice(0, 60)}..."`)
    }
  }
  return { pass: issues.every(i => i.startsWith('⚠️')), issues }
}

function validatePromptStructure(prompt: string) {
  console.log('\n🔍 Prompt 结构验证（无 API，仅检查 prompt 文本）\n')

  const checks: { label: string; pass: boolean }[] = []

  // 检查 tag 指令是否注入
  checks.push({
    label: '包含"内容类型判断"指令',
    pass: prompt.includes('内容类型判断') || prompt.includes('讲演范式')
  })
  checks.push({
    label: '包含"信息驱动型"判断标准',
    pass: prompt.includes('信息驱动型') || prompt.includes('向镜头介绍')
  })
  checks.push({
    label: '包含"讲演范式"规则',
    pass: prompt.includes('讲演范式') || prompt.includes('presentation paradigm')
  })
  checks.push({
    label: '包含"禁止编造虚构背景故事"',
    pass: prompt.includes('禁止编造') || prompt.includes('不编造虚构')
  })
  checks.push({
    label: '包含用户视觉风格要求',
    pass: prompt.includes('70%') || prompt.includes('3D') || prompt.includes('手绘')
  })
  checks.push({
    label: '包含框架语义说明',
    pass: prompt.includes('讲演型') || prompt.includes('口播主持人')
  })
  checks.push({
    label: '包含用户输入内容',
    pass: prompt.includes('武康路') || prompt.includes('上音城堡') || prompt.includes('海宝')
  })

  let passed = 0
  for (const c of checks) {
    passed += c.pass ? 1 : 0
    console.log(`${c.pass ? '✅' : '❌'} ${c.label}`)
  }

  console.log(`\n📊 Prompt 结构: ${passed}/${checks.length} 通过`)
}

async function runFullTest(resultText: string) {
  console.log('\n🔍 解析 JSON...')
  const parsed = extractJsonFromMarkdown(resultText)
  const framework = parsed?.framework || {}
  const directions = parsed?.directions || []

  console.log(`   directions: ${directions.length}, framework 字段: ${Object.keys(framework).join(', ')}`)
  console.log(`   characters: ${(framework.characters || []).length}, acts: ${(framework.acts || []).length}`)

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'presentation_test_result.json'),
    JSON.stringify({ parsed, framework, directions }, null, 2)
  )

  console.log('\n🔬 质量检查...\n')
  const allChecks = [
    { label: 'characters 是讲解员', ...checkCharacters(framework) },
    { label: 'characters 有外观描述（非纯角色定位）', ...checkCharacterAppearance(framework) },
    { label: 'acts 是主题段落', ...checkActs(framework) },
    { label: 'scenes 基于实际内容', ...checkScenes(framework) },
    { label: 'styleGuide 尊重用户要求', ...checkStyleGuide(framework) },
  ]

  let totalPassed = 0
  for (const c of allChecks) {
    totalPassed += c.pass ? 1 : 0
    console.log(`${c.pass ? '✅' : '❌'} ${c.label}`)
    c.issues.forEach(i => console.log(`   ${i}`))
  }

  const allIssues = allChecks.flatMap(c => c.issues)
  const report = {
    passed: totalPassed,
    total: allChecks.length,
    issues: allIssues,
    chars: (framework.characters || []).map((c: any) => ({ name: c.name, role: c.role, desc: c.description?.slice(0, 80) })),
    acts: (framework.acts || []).map((a: any) => ({ title: a.title, n: a.scenes?.length, s: a.scenes?.slice(0, 2) })),
    styleGuide: framework.styleGuide?.slice(0, 200),
    directions: directions.slice(0, 1).map((d: any) => ({ title: d.title, desc: d.description?.slice(0, 200) })),
  }

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'presentation_test_report.json'),
    JSON.stringify(report, null, 2)
  )

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`📊 最终结果: ${totalPassed}/${allChecks.length} 通过`)
  if (allIssues.length > 0) {
    console.log(`\n⚠️ ${allIssues.length} 个问题:`)
    allIssues.filter(i => i.startsWith('❌')).forEach(i => console.log(`   ${i}`))
    allIssues.filter(i => i.startsWith('⚠️')).forEach(i => console.log(`   ${i}`))
  }
  console.log('\n📁 完整结果已保存到 .kimi/api-test-results/')
}

// ==================== 主入口 ====================
async function main() {
  console.log('═'.repeat(60))
  console.log('📋 测试：信息驱动型宣传片框架生成')
  console.log('═'.repeat(60))

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true })

  console.log('\n📄 加载 ideation 模板...')
  const prompt = loadPromptTemplate('ideation', {
    USER_INPUT: MUSEUM_INPUT,
     VISUAL_REFERENCES: `【用户上传了 2 张视觉参考图。用户标注的标签：海宝、海贝。\n` +
      `【角色外观要求】\n` +
      `你必须在 characters[].description 中描述角色的实际外貌特征，包括：颜色、体型、着装/纹样、标志性视觉元素。\n` +
      `请根据图片内容或标签名称推断角色外观（例如标签含"宝"可推断为圆润可爱型，含"贝"可推断为贝壳/海洋元素），禁止只用"风格定位：..."替代外观描述。\n` +
      `对场景/风格元素，必须在 styleGuide 中体现参考图的视觉特征。`,
    PROJECT_TAG_INSTRUCTIONS: `【tag 约束：宣传片】你产出的不是一部完整的影片，而是一部宣传片的核心构思。

【内容类型判断（最高优先级）】
在生成框架前，先分析用户输入判断内容类型。此输入包含"向镜头介绍""口播""导览""依次参观"等关键词，且内容以信息罗列为主（地点→亮点→特色），判定为信息驱动型。

→ 讲演范式（presentation paradigm）：
  1. characters：只生成口播主持人/讲解员，角色描述只写身份和风格定位，禁止编造虚构背景故事
  2. inspiration：总结核心传播目标
  3. acts：每一幕 = 一个主题段落，按宣传内容的自然分组（如：集合出发→建筑探访→美食体验→文化升华），禁止编造剧情冲突
  4. scenes：每个场景 = 一段口播导引文字+对应画面的视觉提示。必须基于用户输入的实际内容，禁止编造角色间的虚构互动和台词
  5. styleGuide：必须尊重用户明确的视觉风格要求，不能擅自替换`,
  })

  console.log(`   模板长度: ${prompt.length} 字符`)
  fs.writeFileSync(path.join(RESULTS_DIR, 'presentation_test_prompt.txt'), prompt)

  console.log('\n🤖 调用 LLM...')
  try {
    const { getTextClient } = await import('@/lib/api-clients/index')
    const textClient = await getTextClient()
    const start = Date.now()
    const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
    console.log(`   ✅ 完成 (${Date.now() - start}ms, ${resultText.length} 字符)`)
    fs.writeFileSync(path.join(RESULTS_DIR, 'presentation_test_raw.txt'), resultText)
    await runFullTest(resultText)
  } catch (e: any) {
    if (e.message?.includes('API_KEY') || e.message?.includes('not configured')) {
      console.log('   ⚠️ API key 未配置，仅做 prompt 结构检查\n')
      validatePromptStructure(prompt)
    } else {
      console.error(`\n❌ 失败: ${e.message}`)
      console.error(e.stack?.split('\n').slice(0, 5).join('\n'))
    }
  }
  console.log(`\n${'═'.repeat(60)}`)
}

main().catch(console.error)
