import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import { startStep, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { checkPoints, deductPointsAndLog, DEFAULT_GENERATE_COST } from '@/lib/points'

const STORY_LENGTH_MAP: Record<string, { label: string; range: string; acts: string; shots: string; desc: string }> = {
  sketch: { label: '速写', range: '1-3分钟', acts: '1-2幕', shots: '10-20镜', desc: '极快节奏，单一场景/单一冲突' },
  short: { label: '短篇', range: '3-5分钟', acts: '2-3幕', shots: '20-40镜', desc: '紧凑叙事，一个完整人物弧线' },
  medium: { label: '中篇', range: '5-10分钟', acts: '3幕', shots: '40-80镜', desc: '标准起承转合，可展开副线' },
  feature: { label: '长片', range: '10-20分钟', acts: '3-4幕', shots: '80-150镜', desc: '复杂叙事，多场景切换' },
  epic: { label: '史诗', range: '20-30分钟', acts: '4-5幕', shots: '150-250镜', desc: '宏大格局，群像/多线' },
}

function buildFrameworkPrompt(userInput: string, selectedDirection: any, storyLengthKey: string) {
  const tier = STORY_LENGTH_MAP[storyLengthKey] || STORY_LENGTH_MAP.short

  return `角色：高端艺术电影 AI 编剧与结构顾问

目标：根据客户的原始灵感和选定的创意方向，输出一份完整的故事框架。你不要生成创意方向（directions），而是直接输出框架（framework）。

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

// ==================== 自动深化辅助函数 ====================

async function updateDeepeningStatus(stepId: string, framework: any, status: string, progress: any) {
  const deepening = {
    ...(framework.deepening || {}),
    status,
    progress,
    updatedAt: new Date().toISOString(),
  }
  const nextFramework = { ...framework, deepening }
  await prisma.workflowStep.update({
    where: { id: stepId },
    data: { outputData: nextFramework },
  })
  await prisma.project.update({
    where: { id: (await prisma.workflowStep.findUnique({ where: { id: stepId } }))!.projectId },
    data: { framework: nextFramework },
  })
  return nextFramework
}

async function deepenCharacters(framework: any, stepId: string) {
  const characters = framework.characters || []
  if (characters.length === 0) return framework

  const textClient = await getTextClient()
  const completedCharacters: any[] = []

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i]
    framework = await updateDeepeningStatus(stepId, framework, 'deepening_characters', {
      current: i + 1,
      total: characters.length,
      phase: `角色深化中（${i + 1}/${characters.length}）`,
    })

    try {
      const prompt = loadPromptTemplate('character-deepen', {
        FRAMEWORK: JSON.stringify(framework, null, 2),
        COMPLETED_CHARACTERS: JSON.stringify(completedCharacters, null, 2),
        CHARACTER_NAME: char.name,
        CHARACTER_ROLE: char.role,
        CHARACTER_DESCRIPTION: char.description || '',
      })

      const resultText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 4096 })
      const parsed = extractJsonFromMarkdown(resultText)

      const deepenedChar = {
        ...char,
        deepened: {
          appearance: parsed.appearance || '',
          personality: parsed.personality || '',
          catchphrase: parsed.catchphrase || '',
          attitudes: parsed.attitudes || {},
          memoryPoints: parsed.memoryPoints || '',
        },
      }
      completedCharacters.push(deepenedChar)

      // 更新 framework 中的角色
      const newCharacters = [...(framework.characters || [])]
      newCharacters[i] = deepenedChar
      framework = { ...framework, characters: newCharacters }
      await updateDeepeningStatus(stepId, framework, 'deepening_characters', {
        current: i + 1,
        total: characters.length,
        phase: `角色深化中（${i + 1}/${characters.length}）`,
      })
    } catch (e: any) {
      console.error(`[DEEPEN-CHARACTER] ${char.name} 深化失败:`, e.message)
      // 失败时保留原角色，继续下一个
      completedCharacters.push(char)
    }
  }

  return framework
}

async function deepenSynopsis(framework: any, stepId: string) {
  framework = await updateDeepeningStatus(stepId, framework, 'deepening_synopsis', {
    current: 1,
    total: 1,
    phase: '故事梗概深化中',
  })

  try {
    const textClient = await getTextClient()
    const prompt = loadPromptTemplate('synopsis-deepen', {
      FRAMEWORK: JSON.stringify(framework, null, 2),
      CHARACTERS: JSON.stringify(framework.characters || [], null, 2),
    })

    const resultText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 6000 })
    const deepenedSynopsis = resultText.trim()

    framework = { ...framework, synopsis: deepenedSynopsis }
    await updateDeepeningStatus(stepId, framework, 'deepening_synopsis', {
      current: 1,
      total: 1,
      phase: '故事梗概深化完成',
    })
  } catch (e: any) {
    console.error('[DEEPEN-SYNOPSIS] 故事梗概深化失败:', e.message)
  }

  return framework
}

async function deepenActs(framework: any, stepId: string) {
  const acts = framework.acts || []
  if (acts.length === 0) return framework

  const textClient = await getTextClient()
  const deepenedActs: any[] = []

  for (let i = 0; i < acts.length; i++) {
    const act = acts[i]
    framework = await updateDeepeningStatus(stepId, framework, 'deepening_acts', {
      current: i + 1,
      total: acts.length,
      phase: `幕结构深化中（${i + 1}/${acts.length}）`,
    })

    try {
      const prompt = loadPromptTemplate('act-deepen', {
        FRAMEWORK: JSON.stringify(framework, null, 2),
        CHARACTERS: JSON.stringify(framework.characters || [], null, 2),
        SYNOPSIS: framework.synopsis || '',
        PREV_ACT: i > 0 ? (deepenedActs[i - 1]?.deepenedContent || '') : '',
        ACT_NO: String(act.actNo || i + 1),
        ACT_TITLE: act.title || '',
        ACT_CONTENT: act.content || '',
      })

      const resultText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 6000 })
      const deepenedContent = resultText.trim()

      const deepenedAct = {
        ...act,
        deepenedContent,
      }
      deepenedActs.push(deepenedAct)

      // 更新 framework 中的幕
      const newActs = [...(framework.acts || [])]
      newActs[i] = deepenedAct
      framework = { ...framework, acts: newActs }
      await updateDeepeningStatus(stepId, framework, 'deepening_acts', {
        current: i + 1,
        total: acts.length,
        phase: `幕结构深化中（${i + 1}/${acts.length}）`,
      })
    } catch (e: any) {
      console.error(`[DEEPEN-ACT] 第${act.actNo || i + 1}幕深化失败:`, e.message)
      deepenedActs.push(act)
    }
  }

  return framework
}

async function extractAndDeepenEnvironments(framework: any, stepId: string) {
  framework = await updateDeepeningStatus(stepId, framework, 'extracting_environments', {
    current: 1,
    total: 1,
    phase: '环境提取中',
  })

  try {
    // 1. 提取环境列表
    const textClient = await getTextClient()
    const extractPrompt = loadPromptTemplate('environment-extract', {
      FRAMEWORK: JSON.stringify(framework, null, 2),
      CHARACTERS: JSON.stringify(framework.characters || [], null, 2),
      ACTS: JSON.stringify(framework.acts || [], null, 2),
    })

    const extractResult = await textClient.generate(extractPrompt, { temperature: 0.7, maxTokens: 4096 })
    const parsed = extractJsonFromMarkdown(extractResult)
    const envList = parsed.environments || []

    if (envList.length === 0) {
      framework = await updateDeepeningStatus(stepId, framework, 'deepening_environments', {
        current: 0,
        total: 0,
        phase: '环境深化完成（无环境提取）',
      })
      return framework
    }

    // 2. 逐个深化环境
    const deepenedEnvironments: any[] = []
    for (let i = 0; i < envList.length; i++) {
      const env = envList[i]
      framework = await updateDeepeningStatus(stepId, framework, 'deepening_environments', {
        current: i + 1,
        total: envList.length,
        phase: `环境深化中（${i + 1}/${envList.length}）`,
      })

      try {
        const deepenPrompt = loadPromptTemplate('environment-deepen', {
          FRAMEWORK: JSON.stringify(framework, null, 2),
          CHARACTERS: JSON.stringify(framework.characters || [], null, 2),
          ACTS: JSON.stringify(framework.acts || [], null, 2),
          ENV_NAME: env.name,
          ENV_BRIEF: env.brief || '',
        })

        const deepenResult = await textClient.generate(deepenPrompt, { temperature: 0.8, maxTokens: 4096 })
        const envParsed = extractJsonFromMarkdown(deepenResult)

        const deepenedEnv = {
          name: env.name,
          brief: env.brief,
          architecture: envParsed.architecture || '',
          atmosphere: envParsed.atmosphere || '',
          culture: envParsed.culture || '',
          distinctive: envParsed.distinctive || '',
          storyFunction: envParsed.storyFunction || '',
        }
        deepenedEnvironments.push(deepenedEnv)

        // 更新 framework 中的环境
        const currentEnvs = framework.environmentsDeepened || []
        framework = { ...framework, environmentsDeepened: [...currentEnvs, deepenedEnv] }
        await updateDeepeningStatus(stepId, framework, 'deepening_environments', {
          current: i + 1,
          total: envList.length,
          phase: `环境深化中（${i + 1}/${envList.length}）`,
        })
      } catch (e: any) {
        console.error(`[DEEPEN-ENV] ${env.name} 深化失败:`, e.message)
        deepenedEnvironments.push({ name: env.name, brief: env.brief })
      }
    }

    // 同时更新 environments 字段为对象数组（前端卡片展示用）
    framework = { ...framework, environments: deepenedEnvironments }
  } catch (e: any) {
    console.error('[DEEPEN-ENV] 环境提取失败:', e.message)
  }

  return framework
}

async function runDeepening(projectId: string, stepId: string, initialFramework: any) {
  console.log('[DEEPEN] 开始自动深化流程')
  let framework = initialFramework

  try {
    // Phase 1: 角色深化
    framework = await deepenCharacters(framework, stepId)

    // Phase 2: 故事梗概 + 幕结构深化
    framework = await deepenSynopsis(framework, stepId)
    framework = await deepenActs(framework, stepId)

    // Phase 3: 环境提取与深化
    framework = await extractAndDeepenEnvironments(framework, stepId)

    // 标记完成
    framework = await updateDeepeningStatus(stepId, framework, 'completed', {
      current: 1,
      total: 1,
      phase: '全部深化完成',
    })

    // 最终保存到数据库（同步 workflowStep 和 project）
    await prisma.$transaction([
      prisma.workflowStep.update({
        where: { id: stepId },
        data: { outputData: framework },
      }),
      prisma.project.update({
        where: { id: projectId },
        data: { framework },
      }),
    ])

    console.log('[DEEPEN] 自动深化流程全部完成')
  } catch (e: any) {
    console.error('[DEEPEN] 自动深化流程失败:', e.message)
    await updateDeepeningStatus(stepId, framework, 'error', {
      current: 0,
      total: 1,
      phase: `深化失败: ${e.message}`,
    })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  if (!await canExecuteStep(params.id, 'FRAMEWORK')) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  const { directionIndex } = await req.json()
  if (typeof directionIndex !== 'number') {
    return NextResponse.json({ error: 'VALID_002' }, { status: 400 })
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

  const pointsCheck = await checkPoints(DEFAULT_GENERATE_COST)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  await startStep(step.id)

  try {
    const prompt = buildFrameworkPrompt(project.rawIdea, selectedDirection, storyLength)
    const textClient = await getTextClient()
    const fullText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 16000 })

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
    setImmediate(async () => {
      try {
        await runDeepening(params.id, step.id, framework)
      } catch (e: any) {
        console.error('[FRAMEWORK] 后台深化失败:', e.message)
      }
    })

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
    await failStep(step.id, e.message)
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

// 工作指令.txt（2026-05-24）：文本编辑 PATCH，保存用户编辑后的 framework 字段
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
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
}
