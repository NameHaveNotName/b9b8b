export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { extractJsonFromMarkdown } from '@/lib/prompts'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'

interface DeepenResult {
  directionTitle: string
  directionDescription: string
  keywords: string[]
  fullText: string
}

async function generateDeepenedVersion(
  originalInput: string,
  currentCreative: string,
  selectedImprovements: string[],
  customFeedback?: string
): Promise<DeepenResult> {
  const textClient = await getTextClient()

  const improvementsText = selectedImprovements.map((imp, i) => `${i + 1}. ${imp}`).join('\n')
  const customText = customFeedback ? `\n【用户自定义反馈】\n${customFeedback}` : ''

  const prompt = `你是一位顶级影视创意顾问。请基于以下信息，优化当前创意，生成一个更吸引人的新版本。

【用户原始创意】
${originalInput}

【当前版本创意】
${currentCreative}

【用户选择的改进方向】
${improvementsText}${customText}

优化目标：
1. 让创意更吸引人（更强的钩子、更独特的世界观、更鲜明的情绪）
2. 保留原始创意的核心锚点，不要偏离到认不出原始输入
3. 这只是创意优化，不是框架搭建。输出中不应出现角色设定、幕结构、分镜等执行层内容

请输出一个创意方向的 JSON，格式如下：
{
  "directionTitle": "优化后的创意标题（一句话）",
  "directionDescription": "优化后的创意详细描述（200-400字）",
  "keywords": ["关键词1", "关键词2", "关键词3"]
}

约束：
- title 要简洁有力，能一句话概括核心创意
- description 要包含世界观、情绪基调、核心冲突、独特卖点
- keywords 3-5 个，每个词要能触发视觉想象
- 返回严格 JSON，不要 Markdown 代码块`

  const resultText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 4096 })
  const parsed = extractJsonFromMarkdown(resultText)

  const directionTitle = String(parsed.directionTitle ?? parsed.title ?? '优化后的创意')
  const directionDescription = String(parsed.directionDescription ?? parsed.description ?? currentCreative)
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map((k: any) => String(k)) : []

  return {
    directionTitle,
    directionDescription,
    keywords,
    fullText: resultText,
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const {
      originalInput,
      currentCreative,
      selectedImprovements,
      customFeedback,
      parentIterationId,
    } = body

    if (!originalInput || !currentCreative) {
      return NextResponse.json(
        { error: 'VALID_001', message: '缺少 originalInput 或 currentCreative' },
        { status: 400 }
      )
    }

    if (!Array.isArray(selectedImprovements) || selectedImprovements.length === 0) {
      return NextResponse.json(
        { error: 'VALID_002', message: '请至少选择一个改进方向' },
        { status: 400 }
      )
    }

    const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
    if (!pointsCheck.ok) {
      return NextResponse.json(
        { error: 'POINTS_001', message: '点数不足，请联系管理员充值' },
        { status: 403 }
      )
    }

    // 获取当前最大版本号
    const lastIteration = await prisma.creativeIteration.findFirst({
      where: { projectId: params.id },
      orderBy: { versionNumber: 'desc' },
    })
    const nextVersion = (lastIteration?.versionNumber ?? 0) + 1

    // 生成优化版本
    const result = await generateDeepenedVersion(
      originalInput,
      currentCreative,
      selectedImprovements,
      customFeedback
    )

    // 将之前的 isCurrent 置为 false
    await prisma.creativeIteration.updateMany({
      where: { projectId: params.id, isCurrent: true },
      data: { isCurrent: false },
    })

    // 创建新记录
    const creativeContent = `## ${result.directionTitle}\n\n${result.directionDescription}\n\n关键词：${result.keywords.join('、')}`

    const iteration = await prisma.creativeIteration.create({
      data: {
        projectId: params.id,
        userId,
        versionNumber: nextVersion,
        originalInput,
        creativeContent,
        selectedImprovement: selectedImprovements.join('; '),
        customFeedback: customFeedback || null,
        isCurrent: true,
      },
    })

    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', {
      projectId: params.id,
      success: true,
    })

    return NextResponse.json({
      success: true,
      iteration: {
        id: iteration.id,
        versionNumber: iteration.versionNumber,
        creativeContent: iteration.creativeContent,
        directionTitle: result.directionTitle,
        directionDescription: result.directionDescription,
        keywords: result.keywords,
      },
    })
  } catch (e: any) {
    console.error('[IDEATION-DEEPEN] Error:', e.message)
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message || '深化生成失败' },
      { status: 500 }
    )
  }
}
