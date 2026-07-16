export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { PROJECT_TAG_PROMPTS } from '@/lib/project-tags'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { startStep, completeStep, failStep } from '@/lib/workflow-executor'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'
import { runDeepening } from '@/lib/framework-deepen'

const STORY_LENGTH_MAP: Record<string, { label: string; range: string; acts: string; shots: string; desc: string }> = {
  sketch: { label: '速写', range: '1-3分钟', acts: '1-2幕', shots: '10-20镜', desc: '极快节奏，单一场景/单一冲突' },
  short: { label: '短篇', range: '3-5分钟', acts: '2-3幕', shots: '20-40镜', desc: '紧凑叙事，一个完整人物弧线' },
  medium: { label: '中篇', range: '5-10分钟', acts: '3幕', shots: '40-80镜', desc: '标准起承转合，可展开副线' },
  feature: { label: '长片', range: '10-20分钟', acts: '3-4幕', shots: '80-150镜', desc: '复杂叙事，多场景切换' },
  epic: { label: '史诗', range: '20-30分钟', acts: '4-5幕', shots: '150-250镜', desc: '宏大格局，群像/多线' },
}

function buildFrameworkPrompt(userInput: string, selectedDirection: any, storyLengthKey: string, tagInstructions?: string) {
  const tier = STORY_LENGTH_MAP[storyLengthKey] || STORY_LENGTH_MAP.short

  return `角色：高端艺术电影 AI 编剧与结构顾问

目标：根据客户的原始灵感和选定的创意方向，输出一份完整的故事框架。你不要生成创意方向（directions），而是直接输出框架（framework）。

${tagInstructions || ''}

【故事分档上下文】
用户选定的故事分档为：${tier.label} · ${tier.range}
该档位的特征：${tier.desc}
推荐幕数：${tier.acts}，推荐镜头数：${tier.shots}

【核心原则】
1. 你必须自行判断这个故事需要几幕、每幕多长、每幕多少镜头。不要固定为三幕，也不要平均分配。
2. 哪一幕可以快速带过（寥寥几个镜头），哪一幕需要细细展开（大量镜头），由你根据叙事需求自行决定。
3. 判断需要几个核心场景/环境，每个环境服务于什么叙事功能。
4. 决定整体节奏策略（哪里紧凑、哪里舒缓）。
5. 动作/惊悚类 ASL 可低至 2-4s，情感/艺术片 ASL 可高至 8-15s，由你根据故事类型自行决定。
6. 无论什么风格，都需要尽量谨慎地使用特效（包括闪光，火花，全息等），尽量避免出现相关内容。

输出格式（严格 JSON，不要 Markdown 代码块）：
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
    "storyLength": "${storyLengthKey}",
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
  }
}

客户的原始灵感：
${userInput}

用户选定的创意方向：
标题：${selectedDirection.title}
描述：${selectedDirection.description}
`
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  // 重新生成需要基于之前保存的 selectedDirection 和 ideation 结果
  const ideationStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } }
  })
  if (!ideationStep || ideationStep.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'WORKFLOW_003' }, { status: 400 })
  }

  const ideationOutput = (ideationStep.outputData as any) || {}
  const directions = ideationOutput.directions || []

  // 从 project.selectedDirection 恢复之前选中的方向
  const savedDirection = project.selectedDirection as any
  let selectedDirection: any = null
  let directionIndex = -1

  if (savedDirection?.title) {
    directionIndex = directions.findIndex((d: any) => d.title === savedDirection.title)
    if (directionIndex >= 0) {
      selectedDirection = directions[directionIndex]
    }
  }

  // 如果没有找到保存的方向，尝试用第一个
  if (!selectedDirection && directions.length > 0) {
    selectedDirection = directions[0]
    directionIndex = 0
  }

  if (!selectedDirection) {
    return NextResponse.json({ error: 'VALID_003', message: '未找到有效的创意方向' }, { status: 400 })
  }

  const storyLength = ideationOutput.storyLength || 'short'
  const projectTag = ideationOutput?.projectTag || ''
  const tagInstructions = projectTag && PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS]
    ? PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS].framework
    : ''

  const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    // 重置步骤状态
    await startStep(step.id)

    // 清空旧的 outputData 中的深化结果，但保留结构便于前端过渡
    const oldOutput = (step.outputData as any) || {}
    const clearedOutput = {
      ...oldOutput,
      deepening: { status: 'idle', progress: { current: 0, total: 1, phase: '等待深化' } },
    }
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { outputData: clearedOutput },
    })

    const currentIteration = await prisma.creativeIteration.findFirst({
      where: { projectId: params.id, isCurrent: true },
      orderBy: { versionNumber: 'desc' },
    })
    const creativeSource = currentIteration?.creativeContent || project.rawIdea
    const prompt = buildFrameworkPrompt(creativeSource, selectedDirection, storyLength, tagInstructions)
    const textClient = await getTextClient()
    const fullText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 16000 })

    const parsed = extractJsonFromMarkdown(fullText)
    const fw = parsed.framework || parsed

    const acts = Array.isArray(fw.acts) ? fw.acts : []
    const normalizedActs = acts.map((a: any, idx: number) => ({
      actNo: a.actNo || a.actNumber || idx + 1,
      title: a.title || `第${idx + 1}幕`,
      content: a.content || a.scenes?.join('；') || '',
      estimatedDuration: a.estimatedDuration || '',
      estimatedShots: typeof a.estimatedShots === 'number' ? a.estimatedShots : 0,
      pacing: a.pacing || '',
      keyScenes: Array.isArray(a.keyScenes) ? a.keyScenes : (Array.isArray(a.scenes) ? a.scenes : []),
    }))

    const framework = {
      inspiration: fw.inspiration || '',
      inspirationSource: creativeSource,
      styleGuide: fw.styleGuide || '',
      background: fw.background || '',
      characters: Array.isArray(fw.characters) ? fw.characters : [],
      synopsis: fw.synopsis || '',
      storyLength: fw.storyLength || storyLength,
      totalDuration: fw.totalDuration || '',
      acts: normalizedActs,
      environments: Array.isArray(fw.environments) ? fw.environments : [],
      overallPacing: fw.overallPacing || '',
      visualStyle: fw.styleGuide || '',
    }

    await prisma.project.update({
      where: { id: params.id },
      data: {
        framework: framework as any,
        selectedDirection: { title: selectedDirection.title, description: selectedDirection.description } as any,
      }
    })

    await completeStep(step.id, framework)
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })

    // 启动后台自动深化
    waitUntil(
      (async () => {
        try {
          await runDeepening(params.id, step.id, framework, projectTag)
        } catch (e: any) {
          console.error('[FRAMEWORK-REGENERATE] 后台深化失败:', e.message)
        }
      })()
    )

    // 更新 Asset
    const existingAsset = await prisma.asset.findFirst({
      where: { projectId: params.id, stepId: step.id, type: 'TEXT' }
    })
    if (existingAsset) {
      await prisma.asset.update({
        where: { id: existingAsset.id },
        data: { metadata: { content: framework, stepType: 'FRAMEWORK' } },
      })
    } else {
      await prisma.asset.create({
        data: {
          projectId: params.id,
          stepId: step.id,
          type: 'TEXT',
          mimeType: 'application/json',
          storageKey: `projects/${params.id}/texts/framework.json`,
          url: '',
          metadata: { content: framework, stepType: 'FRAMEWORK' },
        },
      })
    }

    return NextResponse.json({ success: true, data: framework })
  } catch (e: any) {
    const errMessage = e?.message || String(e) || '未知错误'
    console.error('[FRAMEWORK-REGENERATE] 生成失败:', errMessage)
    try { await failStep(step.id, errMessage) } catch {}
    try { await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: errMessage }) } catch {}
    return NextResponse.json({ error: 'API_001', message: errMessage }, { status: 500 })
  }
}
