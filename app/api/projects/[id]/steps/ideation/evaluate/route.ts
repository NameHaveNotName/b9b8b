export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectAccess, getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { extractJsonFromMarkdown } from '@/lib/prompts'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'

interface EvaluationResult {
  retentionScore: number
  qualityScore: number
  concerns: string
  improvementOptions: string[]
}

async function evaluateCreative(
  originalInput: string,
  currentCreative: string,
  previousCreative: string,
  previousScore: number | null,
  selectedImprovement: string
): Promise<EvaluationResult> {
  const textClient = await getTextClient()

  const prevContext = previousCreative
    ? `\n【上一个版本的创意内容】\n${previousCreative}\n\n【上一个版本的优秀程度分数】${previousScore ?? '无'}\n【上一轮用户选择的改进方向】${selectedImprovement || '无'}`
    : ''

  const prompt = `你是一位资深影视创意评估专家。请对以下创意进行严格、具体的评估，只关注创意概念本身。

【阶段边界限定 - 严格执行】
你当前处于"创意扩散"阶段，只评估"创意概念"本身。
绝对禁止评估以下内容：
- 幕结构、起承转合、分段是否合理
- 角色数量、角色关系网是否完整
- 场景清单、场景动作描写是否到位
- 分镜感、镜头运动、画面切换
- 剧本格式、对白质量

你只评估：故事钩子强度、世界观辨识度、情绪基调、核心意象、概念独特性。

【用户原始创意输入】
${originalInput}

【当前版本创意】
${currentCreative}${prevContext}

请完成以下评估任务，并以严格 JSON 格式返回：

{
  "retentionScore": 78,
  "qualityScore": 65,
  "concerns": "当前创意的世界观设定虽然独特，但故事钩子（开场吸引力）较弱，观众可能在第一分钟就失去兴趣。",
  "improvementOptions": [
    "强化开场钩子：在故事第一分钟内设置一个强烈的视觉奇观或情感冲突",
    "增加情绪反差：在温暖基调中植入一个令人不安的伏笔",
    "设计记忆点符号：创造一个能在观众心中留下深刻印象的视觉符号",
    "压缩世界观解释：将背景信息融入动作和对话中，避免大段说明"
  ]
}

评分规则（严格标准，不要刻意给高分）：
1. retentionScore（原内容保留度 0-100）：
   - 评估当前版本与原始创意的契合程度
   - 越高表示越忠于用户原始意图
   - 如果当前版本明显偏离了原始输入的核心概念，必须打低分

2. qualityScore（优秀程度 0-100）：
   - 评估当前版本作为影视创意的吸引力与完成度
   - 考虑：故事钩子强度、世界观记忆点、情绪反差、独特视觉锚点
   ${previousScore !== null ? `- **对比上一轮**：上一个版本分数是 ${previousScore}。如果当前版本基于改进方向真正优化了对应短板，分数必须上涨（至少 +5）；如果没改进或改糟了，分数必须下降或持平。禁止给同样的分数！` : ''}

3. concerns（核心顾虑）：
   - 只指出 1 个当前版本最大的短板
   - 必须具体指向当前版本的实际内容，不能是通用套话
   ${previousCreative ? '- 必须与上一轮的顾虑不同（除非上一轮的问题完全没改）' : ''}
   - 如果 qualityScore 与上一轮相同，必须在顾虑中说明"改进方向未有效落实"
   - 聚焦"创意是否足够吸引人"

4. improvementOptions（改进选项）：
   - 最多 5 个具体可操作的优化方向
   - 每个聚焦如何让创意更吸引人
   - 必须具体、可操作，不要泛泛而谈

约束：
- 评分要客观，敢于给低分，不要刻意给高分
- concerns 只谈创意概念层面，不涉及执行细节
- improvementOptions 要具体、可操作
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
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const pointsCheck = await checkPoints(GENERATION_COSTS.IDEA_DIFFUSION)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
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
    const { originalInput, currentCreative, previousCreative, previousScore, selectedImprovement, iterationId } = body

    if (!originalInput || !currentCreative) {
      return NextResponse.json(
        { error: 'VALID_001', message: '缺少 originalInput 或 currentCreative' },
        { status: 400 }
      )
    }

    const evaluation = await evaluateCreative(
      originalInput,
      currentCreative,
      previousCreative || '',
      previousScore ?? null,
      selectedImprovement || ''
    )

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

    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, success: true })

    return NextResponse.json({
      success: true,
      evaluation,
    })
  } catch (e: any) {
    console.error('[IDEATION-EVALUATE] Error:', e.message)
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, success: false, errorMessage: e.message })
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message || '评估失败' },
      { status: 500 }
    )
  }
}
