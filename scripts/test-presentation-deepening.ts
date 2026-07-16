/**
 * 测试脚本：验证 trailer/product 标签的 presentation-paradigm 幕结构深化
 *
 * 运行：npx tsx scripts/test-presentation-deepening.ts
 *
 * 验证目标：
 *   1. deepenActs('trailer') 会选用 act-deepen-presentation.txt 模板
 *   2. prompt 中禁止叙事型表述（情绪弧线、角色互动、剧情冲突）
 *   3. prompt 中要求口播/旁白文案 + 视觉卖点
 *   4. synopsis 深化也使用 presentation 模板
 *   5. 非 trailer/product 标签仍使用叙事模板
 */

import fs from 'fs'
import path from 'path'
import { loadPromptTemplate } from '@/lib/prompts'

const RESULTS_DIR = path.join(process.cwd(), '.kimi', 'api-test-results')

// 模拟一个旅游宣传片框架（武康路）
const SAMPLE_FRAMEWORK = {
  inspiration: '传播目标：向观众展示武康路-复兴西路的历史建筑与生活美学，激发城市文化探索欲望',
  styleGuide: '70%精致3D城市动画 + 20%海派生活绘本 + 10%自然电影光影',
  background: '上海衡复历史文化风貌区，武康路沿线',
  characters: [
    {
      id: 'char_001',
      name: '海宝',
      role: '虚拟导游',
      description: '蓝色圆润可爱型吉祥物，活泼亲和，负责向镜头介绍路线亮点',
    },
    {
      id: 'char_002',
      name: '海贝',
      role: '虚拟导游',
      description: '贝壳/海洋元素吉祥物，温柔知性，与海宝搭档讲解',
    },
  ],
  synopsis: '以CityWalk方式漫步武康路，依次探访武康大楼、黄兴旧居、密丹公寓、玫瑰别墅等历史建筑，聆听名人轶事；中午享用本帮午餐；下午走进上音城堡享用下午茶，感受音乐与建筑的交融。',
  storyLength: 'short',
  totalDuration: '3-5分钟',
}

const SAMPLE_ACT = {
  actNo: 2,
  title: '漫步：建筑与人文',
  content: '依次探访黄兴旧居、密丹公寓、玫瑰别墅等历史建筑，讲解名人轶事与建筑风格',
}

const TRAILER_TAG_INSTRUCTIONS = '【tag 约束：宣传片】本项目是旅游/城市/场地宣传片，属于信息驱动型。幕结构深化必须采用"讲演范式"：每段 = 口播/旁白文案 + 对应画面卖点，禁止角色对话、情绪弧线、剧情冲突、关系张力。角色只作为导游/主持人出现，不要戏剧化背景。'

function validatePrompt(prompt: string, label: string): { pass: boolean; issues: string[] } {
  const issues: string[] = []

  // 排除 prompt 自身在【禁止事项】中列出的情况
  const beforeForbid = prompt.split(/【禁止事项】|禁止/)[0] || prompt
  const narrativeInMainBody = /情绪弧线|剧情冲突|关系张力|角色互动/.test(beforeForbid)
  const requiredInfoDriven = /口播|旁白|视觉卖点|画面|信息推进|主题段落|导游|讲解|行动号召|向往感|感染力/
  const hasForbidSection = /禁止角色对话|禁止.*情绪弧线|禁止.*剧情冲突|禁止.*关系张力/.test(prompt)
  const hasTagInstructions = /【tag 约束：宣传片】/.test(prompt)

  if (narrativeInMainBody) {
    issues.push(`❌ ${label} prompt 正文中仍含叙事型关键词`)
  } else {
    issues.push(`✅ ${label} prompt 正文不含叙事型关键词`)
  }

  if (!hasForbidSection) {
    issues.push(`❌ ${label} prompt 未明确禁止叙事元素`)
  } else {
    issues.push(`✅ ${label} prompt 已明确禁止叙事元素`)
  }

  if (!requiredInfoDriven.test(prompt)) {
    issues.push(`❌ ${label} prompt 缺少信息驱动型关键词`)
  } else {
    issues.push(`✅ ${label} prompt 包含信息驱动型关键词`)
  }

  if (!hasTagInstructions) {
    issues.push(`⚠️ ${label} prompt 未注入 tag 约束`)
  } else {
    issues.push(`✅ ${label} prompt 已注入 tag 约束`)
  }

  return { pass: !issues.some(i => i.startsWith('❌')), issues }
}

function buildActPrompt(templateName: string, tagInstructions: string): string {
  return loadPromptTemplate(templateName, {
    FRAMEWORK: JSON.stringify(SAMPLE_FRAMEWORK, null, 2),
    CHARACTERS: JSON.stringify(SAMPLE_FRAMEWORK.characters, null, 2),
    SYNOPSIS: SAMPLE_FRAMEWORK.synopsis,
    PREV_ACT: '',
    ACT_NO: String(SAMPLE_ACT.actNo),
    ACT_TITLE: SAMPLE_ACT.title,
    ACT_CONTENT: SAMPLE_ACT.content,
    TAG_INSTRUCTIONS: tagInstructions,
  })
}

function buildSynopsisPrompt(templateName: string, tagInstructions: string): string {
  return loadPromptTemplate(templateName, {
    FRAMEWORK: JSON.stringify(SAMPLE_FRAMEWORK, null, 2),
    CHARACTERS: JSON.stringify(SAMPLE_FRAMEWORK.characters, null, 2),
    TAG_INSTRUCTIONS: tagInstructions,
  })
}

async function main() {
  console.log('═'.repeat(60))
  console.log('📋 测试：trailer 标签的 presentation-paradigm 深化')
  console.log('═'.repeat(60))

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true })

  // 测试 trailer 的 act 深化 prompt
  console.log('\n🎬 测试：trailer 的 act 深化 prompt')
  console.log('─'.repeat(60))
  const trailerActPrompt = buildActPrompt('act-deepen-presentation', TRAILER_TAG_INSTRUCTIONS)
  fs.writeFileSync(path.join(RESULTS_DIR, 'presentation_deepening_act_trailer_prompt.txt'), trailerActPrompt)
  const actCheck = validatePrompt(trailerActPrompt, 'act-presentation')
  actCheck.issues.forEach(i => console.log(`   ${i}`))
  console.log(`\n📊 trailer act prompt 校验: ${actCheck.pass ? '通过' : '未通过'}`)
  console.log('\n📄 prompt 前 1200 字预览：')
  console.log(trailerActPrompt.slice(0, 1200))

  // 测试 trailer 的 synopsis 深化 prompt
  console.log('\n🎬 测试：trailer 的 synopsis 深化 prompt')
  console.log('─'.repeat(60))
  const trailerSynopsisPrompt = buildSynopsisPrompt('synopsis-deepen-presentation', TRAILER_TAG_INSTRUCTIONS)
  fs.writeFileSync(path.join(RESULTS_DIR, 'presentation_deepening_synopsis_trailer_prompt.txt'), trailerSynopsisPrompt)
  const synopsisCheck = validatePrompt(trailerSynopsisPrompt, 'synopsis-presentation')
  synopsisCheck.issues.forEach(i => console.log(`   ${i}`))
  console.log(`\n📊 trailer synopsis prompt 校验: ${synopsisCheck.pass ? '通过' : '未通过'}`)
  console.log('\n📄 prompt 前 1200 字预览：')
  console.log(trailerSynopsisPrompt.slice(0, 1200))

  // 测试非 trailer 标签仍使用叙事模板
  console.log('\n🎬 测试：非 trailer 标签仍使用叙事模板')
  console.log('─'.repeat(60))
  const narrativeActPrompt = buildActPrompt('act-deepen', '')
  fs.writeFileSync(path.join(RESULTS_DIR, 'presentation_deepening_act_narrative_prompt.txt'), narrativeActPrompt)
  const narrativeHasNarrative = /情绪弧线|剧情冲突|关系张力|角色互动/.test(narrativeActPrompt)
  const narrativeHasNoTag = !/【tag 约束】/.test(narrativeActPrompt)
  console.log(`   ${narrativeHasNarrative ? '✅' : '❌'} 叙事模板包含叙事型关键词`)
  console.log(`   ${narrativeHasNoTag ? '✅' : '⚠️'} 叙事模板不含 tag 约束（符合预期）`)

  // 汇总
  console.log('\n' + '═'.repeat(60))
  const totalPass = actCheck.pass && synopsisCheck.pass
  console.log(`📊 最终结果: ${totalPass ? '✅ 全部通过' : '❌ 存在未通过项'}`)
  console.log('📁 详细 prompt 已保存到 .kimi/api-test-results/')
  console.log('═'.repeat(60))
}

main().catch(console.error)
