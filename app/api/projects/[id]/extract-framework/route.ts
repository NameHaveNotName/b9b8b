export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'

const EXTRACT_PROMPT = `角色：高端艺术电影 AI 编剧与结构顾问

目标：从用户提供的完整故事文本中，提取关键信息并填充到故事框架结构中。

【任务说明】
用户已经有了一个较为完整的故事，不需要创意扩散。你的任务是：
1. 仔细阅读用户提供的故事文本
2. 从中提取角色、场景、情节结构等关键信息
3. 填充到标准的故事框架结构中
4. 对于故事中明确提到的信息，忠实保留原文
5. 对于故事中缺失或模糊的信息，根据上下文合理补充

【输出格式】（严格 JSON，不要 Markdown 代码块）
{
  "framework": {
    "inspiration": "灵感阐释：形如论文的摘要，将影片的精彩点和大体故事进行简述...",
    "styleGuide": "风格规范：简单分析整个故事的背景和剧情，对画面内容给出明确的规范要求...",
    "background": "背景环境设定：根据故事内容分析整体故事发生的时代背景环境...",
    "characters": [
      {
        "id": "char_001",
        "name": "角色名",
        "role": "主角/配角",
        "description": "性格、形象等基本信息..."
      }
    ],
    "synopsis": "用一段话概括整个故事的核心冲突和结局...",
    "storyLength": "根据故事长度和复杂度判断：sketch/short/medium/feature/epic",
    "totalDuration": "预估总时长，如'4分钟'",
    "acts": [
      {
        "actNo": 1,
        "title": "幕标题（如'开端'）",
        "content": "该幕的内容概述...",
        "estimatedDuration": "该幕预估时长，如'1.5分钟'",
        "estimatedShots": 15,
        "pacing": "紧凑快切 / 舒缓长镜头 / 张弛有度",
        "keyScenes": ["核心场景1", "核心场景2"]
      }
    ],
    "environments": ["环境1", "环境2"],
    "overallPacing": "整体节奏策略说明..."
  },
  "missingFields": ["列出故事中缺失但重要的信息字段"],
  "supplementedContent": {
    "字段名": "补充的内容说明"
  }
}

【重要原则】
1. 忠实于原文：故事中明确提到的信息必须保留，不要随意修改
2. 合理补充：对于缺失的信息，根据故事上下文和类型合理推断
3. 结构完整：确保输出的 framework 结构完整，所有字段都有值
4. 缺失标记：在 missingFields 中标记故事中确实无法提取的字段

用户提供的故事文本：
{{USER_INPUT}}`

// 重试配置
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 2000

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
  }

  if (!project.rawIdea || project.rawIdea.length < 100) {
    return NextResponse.json({
      error: 'CONTENT_TOO_SHORT',
      message: '故事内容过短，请先上传完整的故事文件'
    }, { status: 400 })
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[EXTRACT-FRAMEWORK] 重试第 ${attempt} 次，等待 ${RETRY_DELAY_MS}ms`)
        await sleep(RETRY_DELAY_MS * attempt)
      }

      const textClient = await getTextClient()
      const prompt = EXTRACT_PROMPT.replace('{{USER_INPUT}}', project.rawIdea)

      console.log('[EXTRACT-FRAMEWORK] 开始提取，内容长度:', project.rawIdea.length, 'attempt:', attempt + 1)
      const resultText = await textClient.generate(prompt, {
        temperature: 0.3,
        maxTokens: 12000,
      })

      console.log('[EXTRACT-FRAMEWORK] LLM 返回长度:', resultText.length)

      const parsed = extractJsonFromMarkdown(resultText)

      if (!parsed.framework) {
        throw new Error('LLM 未返回有效的 framework 结构')
      }

      // 确保必要字段存在
      const framework = parsed.framework
      if (!framework.characters || !Array.isArray(framework.characters)) {
        framework.characters = []
      }
      if (!framework.acts || !Array.isArray(framework.acts)) {
        framework.acts = []
      }
      if (!framework.environments || !Array.isArray(framework.environments)) {
        framework.environments = []
      }

      // 自动判断 storyLength
      const contentLength = project.rawIdea.length
      if (!framework.storyLength) {
        if (contentLength < 500) framework.storyLength = 'sketch'
        else if (contentLength < 1500) framework.storyLength = 'short'
        else if (contentLength < 5000) framework.storyLength = 'medium'
        else if (contentLength < 15000) framework.storyLength = 'feature'
        else framework.storyLength = 'epic'
      }

      const result = {
        framework,
        missingFields: parsed.missingFields || [],
        supplementedContent: parsed.supplementedContent || {},
        rawText: resultText.slice(0, 3000),
      }

      console.log('[EXTRACT-FRAMEWORK] 提取成功，attempt:', attempt + 1)
      return NextResponse.json({ success: true, data: result })
    } catch (e: any) {
      lastError = e
      console.error(`[EXTRACT-FRAMEWORK] attempt ${attempt + 1} 失败:`, e.message)

      // 客户端错误不重试
      if (e.message?.includes('401') || e.message?.includes('403') || e.message?.includes('400')) {
        break
      }
    }
  }

  console.error('[EXTRACT-FRAMEWORK] 所有重试均失败')
  return NextResponse.json({
    error: 'API_001',
    message: lastError?.message || '提取失败，请稍后重试'
  }, { status: 500 })
}
