import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient, getImageClient } from '@/lib/api-clients'
import { loadPromptTemplate } from '@/lib/prompts'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  if (!await canExecuteStep(params.id, 'TRAILER')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  if (!storyboardStep || storyboardStep.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'WORKFLOW_003' }, { status: 400 })
  }

  let step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'TRAILER' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  await startStep(step.id)

  try {
    const shots = (storyboardStep.outputData as any)?.shots || []
    const framework = project.framework as any
    const characters = framework?.characters || []
    const imageClient = await getImageClient()
    const textClient = await getTextClient()

    // 获取选定的风格提示词
    const styleAsset = project.selectedStyleId
      ? await prisma.asset.findFirst({
          where: { projectId: params.id, type: 'IMAGE', metadata: { path: ['styleId'], equals: project.selectedStyleId } },
        })
      : await prisma.asset.findFirst({
          where: { projectId: params.id, type: 'IMAGE' },
          orderBy: { createdAt: 'asc' },
        })
    const selectedStylePrompt = (styleAsset?.metadata as any)?.stylePrompt ||
      'cinematic film still, 35mm Kodak Portra 400, soft grain, atmospheric depth, 8K'

    const results = []

    for (const shot of shots) {
      const charNames = shot.characters
        .map((cid: string) => characters.find((c: any) => c.id === cid)?.name || '未知角色')
        .join(',')

      // 用 concept 模板生成代表画面提示词
      const prompt = loadPromptTemplate('concept', {
        USER_INPUT: JSON.stringify({
          framework,
          selectedStyle: selectedStylePrompt,
          shotDescription: shot.description,
          keyAction: shot.keyAction,
          characters: charNames,
        })
      })
      const promptText = await textClient.generate(prompt, { temperature: 0.7, maxTokens: 2048 })

      const label = `${shot.shotId} 高潮瞬间 - ${charNames} ${shot.keyAction || '关键动作'}`
      const result = await imageClient.generateConceptScene(params.id, label, selectedStylePrompt, shot.characters)

      const asset = await prisma.asset.create({
        data: {
          projectId: params.id,
          stepId: step.id,
          type: 'IMAGE',
          mimeType: 'image/png',
          storageKey: `projects/${params.id}/representative/${shot.shotId}.png`,
          url: result.url,
          metadata: { shotId: shot.shotId, type: 'representative', sceneDesc: label, llmPrompt: promptText },
        }
      })
      results.push({ shotId: shot.shotId, assetId: asset.id, url: result.url })
    }

    await completeStep(step.id, { results, count: results.length })
    return NextResponse.json({ success: true, data: { results, count: results.length } })
  } catch (e: any) {
    await failStep(step.id, e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'TRAILER' } },
    include: { resultAssets: true }
  })
  if (!step) return NextResponse.json({ status: 'not_found' })
  return NextResponse.json({ status: step.status, outputData: step.outputData, assets: step.resultAssets })
}
