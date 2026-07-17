export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { extractJsonFromMarkdown } from '@/lib/prompts'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'

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

  const prompt = `你是一位顶级影视创意顾问。请基于以下信息，针对用户选中的改进方向，精准优化当前创意。

【阶段边界限定 - 严格执行】
你当前处于"创意扩散"阶段，只负责优化"创意概念"本身。
绝对禁止输出以下内容：
- 幕结构建议（几幕、起承转合、分段、节奏曲线）
- 角色设定细节（角色数量、角色关系网、角色背景故事）
- 场景清单或场景动作描写
- 分镜感描述（镜头如何运动、画面如何切换）
- 剧本格式内容（对白、动作指示、场次编号）

你只允许优化：故事钩子、世界观辨识度、情绪基调、核心意象、概念独特性。

【用户原始创意】
${originalInput}

【当前版本创意】
${currentCreative}

【用户选中的改进方向（只修改这一项）】
${improvementsText}${customText}

优化约束：
1. **精准修改**：只针对选中的改进方向进行修改，没问题的部分保持原样，不要重写整个世界观
2. **篇幅严格限制**：
   - directionTitle：一句话，≤30字
   - directionDescription：200-400字，绝对禁止超过500字
   - 如果修改后超出400字，必须压缩删减，保留核心概念
3. **内容黑名单**：
   - 禁止出现具体场景动作描写
   - 禁止出现角色对话
   - 禁止出现幕结构、起承转合、分段建议
   - 禁止出现"第一幕...第二幕..."等结构词汇
   - 禁止出现场景清单或角色数量设定
4. **格式要求**：
   - 一句话核心概念（钩子）
   - 一段世界观/情绪描述（≤300字）
   - 2-4个关键词标签
5. 保留原始创意的核心锚点，不要偏离到认不出原始输入

请输出一个创意方向的 JSON，格式如下：
{
  "directionTitle": "优化后的创意标题（一句话）",
  "directionDescription": "优化后的创意详细描述（200-400字）",
  "keywords": ["关键词1", "关键词2", "关键词3"]
}

约束：
- 返回严格 JSON，不要 Markdown 代码块
- 不要解释你的修改逻辑，只输出 JSON`

  const resultText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 4096 })
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
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const pointsCheck = await checkPoints(GENERATION_COSTS.IDEA_DIFFUSION)
  if (!pointsCheck.ok) {
    return NextResponse.json(
      { error: 'POINTS_001', message: '点数不足，请联系管理员充值' },
      { status: 403 }
    )
  }

  try {
    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    }
    const access = await checkProjectAccess(project.userId)
    if (!access.allowed) {
      return access.response
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
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', {
      projectId: params.id,
      success: false,
      errorMessage: e.message,
    })
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message || '深化生成失败' },
      { status: 500 }
    )
  }
}
