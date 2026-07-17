export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { getProjectReferences } from '@/lib/style-ref'
import { PROJECT_TAG_PROMPTS } from '@/lib/project-tags'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { runDeepening } from '@/lib/framework-deepen'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'

const STORY_LENGTH_MAP: Record<string, { label: string; range: string; acts: string; shots: string; desc: string }> = {
  sketch: { label: '速写', range: '1-3分钟', acts: '1-2幕', shots: '10-20镜', desc: '极快节奏，单一场景/单一冲突' },
  short: { label: '短篇', range: '3-5分钟', acts: '2-3幕', shots: '20-40镜', desc: '紧凑叙事，一个完整人物弧线' },
  medium: { label: '中篇', range: '5-10分钟', acts: '3幕', shots: '40-80镜', desc: '标准起承转合，可展开副线' },
  feature: { label: '长片', range: '10-20分钟', acts: '3-4幕', shots: '80-150镜', desc: '复杂叙事，多场景切换' },
  epic: { label: '史诗', range: '20-30分钟', acts: '4-5幕', shots: '150-250镜', desc: '宏大格局，群像/多线' },
}

function buildFrameworkPrompt(userInput: string, selectedDirection: any, storyLengthKey: string, visualReferences?: string, tagInstructions?: string) {
  const tier = STORY_LENGTH_MAP[storyLengthKey] || STORY_LENGTH_MAP.short

  return `角色：高端艺术电影 AI 编剧与结构顾问

目标：根据客户的原始灵感和选定的创意方向，输出一份完整的故事框架。你不要生成创意方向（directions），而是直接输出框架（framework）。

${visualReferences || ''}
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

  if (!await canExecuteStep(params.id, 'FRAMEWORK')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  // 防御：某些情况下 req.json() 会抛异常，先用 text() 读取原始内容
  const rawBody = await req.text()
  console.log('[FRAMEWORK] raw body length:', rawBody.length, 'content:', rawBody.slice(0, 200))
  let body: any = {}
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch (parseErr: any) {
    console.error('[FRAMEWORK] body parse error:', parseErr.message, 'raw:', rawBody.slice(0, 200))
    return NextResponse.json({ error: 'VALID_002', message: '请求体不是有效 JSON' }, { status: 400 })
  }
  const directionIndex = body.directionIndex
  if (typeof directionIndex !== 'number') {
    console.error('[FRAMEWORK] directionIndex invalid:', directionIndex, 'body:', JSON.stringify(body).slice(0, 200))
    return NextResponse.json({ error: 'VALID_002', message: `directionIndex 必须是数字，收到: ${typeof directionIndex}` }, { status: 400 })
  }

  const ideationStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } }
  })
  if (!ideationStep || ideationStep.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'WORKFLOW_003' }, { status: 400 })
  }

  const ideationOutput = (ideationStep.outputData as any) || {}
  const directions = ideationOutput.directions || []
  const selectedDirection = directions[directionIndex]
  if (!selectedDirection) {
    return NextResponse.json({ error: 'VALID_003' }, { status: 400 })
  }

  // 读取 storyLength，旧项目兼容默认 short
  const storyLength = ideationOutput.storyLength || 'short'

  let step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  if (step.status === 'COMPLETED' && step.outputData) {
    console.log('[FRAMEWORK] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  const pointsCheck = await checkPoints(GENERATION_COSTS.FRAMEWORK + GENERATION_COSTS.FRAMEWORK_DEEPEN_ALL)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    await startStep(step.id)
    // 优先使用 CreativeIteration 中当前版本的创意内容
  const currentIteration = await prisma.creativeIteration.findFirst({
    where: { projectId: params.id, isCurrent: true },
    orderBy: { versionNumber: 'desc' },
  })
  const creativeSource = currentIteration?.creativeContent || project.rawIdea

  const ideationStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } },
  })
  const outputData: any = ideationStep?.outputData || {}
  const projectTag = outputData?.projectTag || ''
  const tagInstructions = projectTag && PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS]
    ? PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS].framework
    : ''

  const references = await getProjectReferences(params.id).catch(() => [])
  const hasRefs = references.length > 0 && references.some(r => r.url)

  let visualRefBlock = ''
  if (hasRefs) {
    const refLabels = references.filter(r => r.labels?.length).flatMap(r => r.labels)
    visualRefBlock = refLabels.length > 0
      ? `【用户上传了视觉参考图，请仔细查看。用户标注的标签：${refLabels.join('、')}。\n请在框架设计时充分考虑这些参考图，角色形象、场景氛围、美术风格应与参考素材一致。】\n`
      : '【用户上传了视觉参考图，请仔细查看。请在框架设计时充分考虑这些参考图，角色形象、场景氛围、美术风格应与参考素材一致。】\n'
  }

  const prompt = buildFrameworkPrompt(creativeSource, selectedDirection, storyLength, hasRefs ? visualRefBlock : '', tagInstructions)
    const textClient = await getTextClient()

    let fullText: string
    if (hasRefs) {
      const refUrls = references.filter(r => r.url).map(r => r.url)
      const refLabels = references.filter(r => r.labels?.length).flatMap(r => r.labels)
      console.log(`[FRAMEWORK-VISION] Using multimodal with ${refUrls.length} reference images`)
      fullText = await textClient.generateVision({
        prompt,
        imageUrls: refUrls,
        imageLabels: refLabels,
        temperature: 0.8,
        maxTokens: 16000,
      })
    } else {
      fullText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 16000 })
    }

    const parsed = extractJsonFromMarkdown(fullText)
    const fw = parsed.framework || parsed

    // 动态 acts 结构（兼容旧数据无 acts 的情况）
    const acts = Array.isArray(fw.acts) ? fw.acts : []
    // 确保每个 act 都有必要字段（AI 可能遗漏）
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

    // 更新项目表：保存框架数据和选定的方向标题
    await prisma.project.update({
      where: { id: params.id },
      data: {
        framework: framework as any,
        selectedDirection: { title: selectedDirection.title, description: selectedDirection.description } as any,
      }
    })

    await completeStep(step.id, framework)
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })

    // 启动后台自动深化（Phase 1-3：角色 → 故事梗概+幕结构 → 环境）
    waitUntil(
      (async () => {
        try {
          await runDeepening(params.id, step.id, framework, projectTag)
        } catch (e: any) {
          console.error('[FRAMEWORK] 后台深化失败:', e.message)
        }
      })()
    )

    // 文本类步骤也应保存 outputData 到 Asset，确保资产库能展示
    const existingAsset = await prisma.asset.findFirst({
      where: { projectId: params.id, stepId: step.id, type: 'TEXT' }
    })
    if (existingAsset) {
      await prisma.asset.update({
        where: { id: existingAsset.id },
        data: {
          metadata: { content: framework, stepType: 'FRAMEWORK' },
        },
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
    console.error('[FRAMEWORK] 生成失败:', errMessage)
    try {
      await failStep(step.id, errMessage)
    } catch (failErr: any) {
      console.error('[FRAMEWORK] failStep 失败:', failErr?.message)
    }
    try {
      await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: errMessage })
    } catch (logErr: any) {
      console.error('[FRAMEWORK] deductPointsAndLog 失败:', logErr?.message)
    }
    return NextResponse.json({ error: 'API_001', message: errMessage }, { status: 500 })
  }
}

// 工作指令.txt（2026-05-24）：文本编辑 PATCH，保存用户编辑后的 framework 字段
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

  const body = await req.json().catch(() => ({}))
  const { background, styleGuide, characters, synopsis, acts, inspiration, visualStyle, storyLength, totalDuration, environments, overallPacing, selectedStyleImage } = body

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const existingOutput = (step.outputData as any) || {}
  const nextOutput = {
    ...existingOutput,
    ...(background !== undefined && { background }),
    ...(styleGuide !== undefined && { styleGuide }),
    ...(characters !== undefined && { characters }),
    ...(synopsis !== undefined && { synopsis }),
    ...(acts !== undefined && { acts }),
    ...(inspiration !== undefined && { inspiration }),
    ...(visualStyle !== undefined && { visualStyle }),
    ...(storyLength !== undefined && { storyLength }),
    ...(totalDuration !== undefined && { totalDuration }),
    ...(environments !== undefined && { environments }),
    ...(overallPacing !== undefined && { overallPacing }),
    ...(selectedStyleImage !== undefined && { selectedStyleImage }),
  }

  try {
    // 同步更新 project.framework（后续步骤读取的单一数据源）
    await prisma.$transaction([
      prisma.workflowStep.update({
        where: { id: step.id },
        data: { outputData: nextOutput }
      }),
      prisma.project.update({
        where: { id: params.id },
        data: { framework: nextOutput }
      })
    ])

    console.log('[TEXT-EDIT-FRAMEWORK] 保存 framework 字段成功')
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[TEXT-EDIT-FRAMEWORK] 保存失败:', e.message)
    return NextResponse.json(
      { error: 'DB_001', message: '保存失败: ' + e.message },
      { status: 500 }
    )
  }
}
