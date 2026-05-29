import { NextResponse } from 'next/server'
import { auth, isDemoMode, DEMO_USER } from '@/auth'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { createStep, startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  // Demo 模式：允许操作 demo 用户的项目
  const isOwner = project?.userId === session.user.id
  const isDemoProject = isDemoMode && project?.userId === DEMO_USER.id

  if (!project || (!isOwner && !isDemoProject)) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  if (!await canExecuteStep(params.id, 'IDEATION')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  let step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } }
  })
  if (!step) {
    step = await createStep(params.id, 'IDEATION', 0)
  }

  // 幂等保护：已完成则直接返回历史结果，避免重复消耗 API 配额并覆盖结果
  if (step.status === 'COMPLETED' && step.outputData) {
    console.log('[IDEATION] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  await startStep(step.id)

  try {
    const prompt = loadPromptTemplate('ideation', { USER_INPUT: project.rawIdea })
    const textClient = await getTextClient()
    const resultText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 12000 })

    // 调试日志
    console.log('[IDEATION] resultText length:', resultText.length)
    console.log('[IDEATION] resultText preview:', resultText.slice(0, 200))

    const parsed = extractJsonFromMarkdown(resultText)
    const directions = parsed.directions || []
    const framework = parsed.framework || {}
    const storyLength = parsed.storyLength || 'short'
    const storyLengthLabel = parsed.storyLengthLabel || '短篇 · 3-5分钟'
    const storyLengthDesc = parsed.storyLengthDesc || ''

    console.log('[IDEATION] parsed directions:', JSON.stringify(directions).slice(0, 500))
    console.log('[IDEATION-DEBUG] 解析出的方向数量:', Array.isArray(directions) ? directions.length : '非数组')
    console.log('[IDEATION-DEBUG] 第一个方向:', directions?.[0])
    console.log('[IDEATION-DEBUG] 推荐分档:', storyLength, storyLengthLabel)

    // 防止 LLM 不遵守 prompt 只输出 1 个方向(2026-05-04 用户报告问题)
    if (!Array.isArray(directions) || directions.length < 3) {
      throw new Error(
        `IDEATION_INSUFFICIENT_DIRECTIONS: LLM 返回方向数量不足。期望>=3,实际=${
          Array.isArray(directions) ? directions.length : '非数组'
        }。请重试或检查 prompts/ideation.txt。`
      )
    }

    const result = { directions, framework, storyLength, storyLengthLabel, storyLengthDesc, rawText: resultText.slice(0, 3000) }
    await completeStep(step.id, result)

    // 文本类步骤也应保存 outputData 到 Asset，确保资产库能展示
    const existingAsset = await prisma.asset.findFirst({
      where: { projectId: params.id, stepId: step.id, type: 'TEXT' }
    })
    if (existingAsset) {
      await prisma.asset.update({
        where: { id: existingAsset.id },
        data: {
          metadata: { content: resultText, directions, framework, storyLength, storyLengthLabel, storyLengthDesc, stepType: 'IDEATION' },
        },
      })
    } else {
      await prisma.asset.create({
        data: {
          projectId: params.id,
          stepId: step.id,
          type: 'TEXT',
          mimeType: 'application/json',
          storageKey: `projects/${params.id}/texts/ideation-data.json`,
          url: '',
          metadata: { content: resultText, directions, framework, storyLength, storyLengthLabel, storyLengthDesc, stepType: 'IDEATION' },
        },
      })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (e: any) {
    console.error('[IDEATION] Error:', e.message)
    await failStep(step.id, e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

// 工作指令.txt（2026-05-24）：文本编辑 PATCH，保存用户编辑后的 directions
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  const isOwner = project?.userId === session.user.id
  const isDemoProject = isDemoMode && project?.userId === DEMO_USER.id

  if (!project || (!isOwner && !isDemoProject)) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { directions, storyLength, storyLengthLabel, storyLengthDesc } = body

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const existingOutput = (step.outputData as any) || {}
  const nextOutput: any = { ...existingOutput }

  if (Array.isArray(directions)) {
    nextOutput.directions = directions
  }
  if (storyLength !== undefined) {
    nextOutput.storyLength = storyLength
  }
  if (storyLengthLabel !== undefined) {
    nextOutput.storyLengthLabel = storyLengthLabel
  }
  if (storyLengthDesc !== undefined) {
    nextOutput.storyLengthDesc = storyLengthDesc
  }

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: { outputData: nextOutput }
  })

  console.log('[TEXT-EDIT-IDEATION] 保存成功, directions:', directions?.length, 'storyLength:', nextOutput.storyLength)
  return NextResponse.json({ success: true })
}
