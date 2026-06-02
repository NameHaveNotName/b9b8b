export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { extractJsonFromMarkdown } from '@/lib/prompts'

interface EvaluationResult {
  retentionScore: number
  qualityScore: number
  concerns: string
  improvementOptions: string[]
}

async function evaluateCreative(originalInput: string, currentCreative: string): Promise<EvaluationResult> {
  const textClient = await getTextClient()

  const prompt = `你是一位资深影视创意评估专家。请对以下创意进行评估，只关注创意本身的概念吸引力，不涉及角色、幕结构、分镜等执行细节。

【用户原始创意输入】
${originalInput}

【当前版本创意】
${currentCreative}

请完成以下评估任务，并以严格 JSON 格式返回：

{
  "retentionScore": 78,
  "qualityScore": 65,
  "concerns": "当前创意的世界观设定虽然独特，但故事钩子（开场吸引力）较弱，观众可能在第一幕就失去兴趣。",
  "improvementOptions": [
    "强化开场钩子：在故事第一分钟内设置一个强烈的视觉奇观或情感冲突",
    "增加情绪反差：在温暖基调中植入一个令人不安的伏笔",
    "设计记忆点符号：创造一个能在观众心中留下深刻印象的视觉符号",
    "压缩世界观解释：将背景信息融入动作和对话中，避免大段说明",
    "添加角色关系张力：引入一个与主角目标对立但令人同情的角色"
  ]
}

评分规则：
1. retentionScore（原内容保留度 0-100）：评估当前版本与原始创意的契合程度。越高表示越忠于用户原始意图。重点：当 qualityScore 足够高时，retentionScore 不应过低。
2. qualityScore（优秀程度 0-100）：评估当前版本作为影视创意的吸引力与完成度。考虑：故事钩子强度、世界观记忆点、情绪反差、独特视觉锚点。
3. concerns（核心顾虑）：只指出 1 个最大的问题，聚焦"创意是否足够吸引人"。
4. improvementOptions（改进选项）：最多 5 个具体可操作的优化方向，每个聚焦如何让创意更吸引人。

约束：
- 评分要客观，不要刻意给高分
- concerns 只谈创意概念层面，不涉及执行细节
- improvementOptions 要具体、可操作，不要泛泛而谈
- 返回严格 JSON，不要 Markdown 代码块`

  const resultText = await textClient.generate(prompt, { temperature: 0.5, maxTokens: 4096 })
  const parsed = extractJsonFromMarkdown(resultText)

  // 标准化字段
  const retentionScore = Math.min(100, Math.max(0, Number(parsed.retentionScore ?? parsed.retention_score ?? 50)))
  const qualityScore = Math.min(100, Math.max(0, Number(parsed.qualityScore ?? parsed.quality_score ?? 50)))
  const concerns = String(parsed.concerns ?? parsed.concern ?? '暂无顾虑')
  const improvementOptions = Array.isArray(parsed.improvementOptions ?? parsed.improvement_options)
    ? (parsed.improvementOptions ?? parsed.improvement_options).map((o: any) => String(o))
    : []

  return { retentionScore, qualityScore, concerns, improvementOptions }
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
    const { originalInput, currentCreative, iterationId } = body

    if (!originalInput || !currentCreative) {
      return NextResponse.json(
        { error: 'VALID_001', message: '缺少 originalInput 或 currentCreative' },
        { status: 400 }
      )
    }

    const evaluation = await evaluateCreative(originalInput, currentCreative)

    // 如果有 iterationId，更新对应记录的评估结果
    if (iterationId) {
      await prisma.creativeIteration.update({
        where: { id: iterationId },
        data: {
          retentionScore: evaluation.retentionScore,
          qualityScore: evaluation.qualityScore,
          concerns: evaluation.concerns,
          improvementOptions: evaluation.improvementOptions,
        },
      })
    }

    return NextResponse.json({
      success: true,
      evaluation,
    })
  } catch (e: any) {
    console.error('[IDEATION-EVALUATE] Error:', e.message)
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message || '评估失败' },
      { status: 500 }
    )
  }
}
