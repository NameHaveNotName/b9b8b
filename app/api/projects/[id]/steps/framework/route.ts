export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { getProjectReferences } from '@/lib/style-ref'
import { PROJECT_TAG_PROMPTS } from '@/lib/project-tags'
import { getBusinessGoalPrompt } from '@/lib/business-goals'
import { extractJsonFromMarkdown } from '@/lib/prompts'
import { runDeepening } from '@/lib/framework-deepen'
import { claimStepForGeneration, completeStep, failStep, canExecuteStep } from '@/lib/workflow-executor'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'
import { getStepAssetConstraints } from '@/lib/asset-constraints'
import { normalizeFrameworkEntities } from '@/lib/character-generation-policy'

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
7. 严格区分“需要跨镜保持身份一致的角色”和“道具、产品、屏幕内容、字幕、PPT、后期素材”。后者不得放入 characters，应放入 productionElements。
8. 用户写“昵称（某形象）”“角色A使用某形象”时，昵称是剧中称呼，括号或后半句是视觉身份。不得把昵称按字面改造成另一物种，也不得因品牌或授权猜测静默替换用户明确指定的形象；如需确认，只记录 referenceNeedsConfirmation。
9. 参考图只在其用途明确时生效。不得让某角色参考图污染其他角色，也不得把画风参考中的人物当作故事角色。
10. 混合媒介必须拆成环境层、角色渲染层和合成层。例如“真实环境中的Q版二维角色”必须保留真实摄影背景，并说明二维角色的接触阴影、透视和环境光融合，不能把整张图统一画成纯动画。

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
        "entityType": "HUMAN/ANIMAL/CREATURE/MASCOT/PRODUCT",
        "requiresCharacterAsset": true,
        "visualIdentity": "角色不可变的视觉身份；昵称不得覆盖此身份",
        "identityReferenceHint": "如有明确参考图，写明它只属于哪个角色；没有则留空",
        "description": "性格、形象等基本信息..."
      }
    ],
    "productionElements": [
      {
        "id": "element_001",
        "name": "PPT、屏幕内容、字幕、道具或后期素材",
        "type": "SCREEN_CONTENT/POST_PRODUCTION/PROP/PRODUCT",
        "description": "用途说明",
        "handling": "实拍道具/后期剪入/单独产品素材；不得生成角色母版"
      }
    ],
    "visualStyleLayers": {
      "environment": "真实或绘制环境的媒介、光线、镜头与景深",
      "characterRendering": "角色自身的造型、描边、上色和材质",
      "compositing": "角色与环境之间的透视、比例、接触阴影和环境光关系"
    },
    "referenceNeedsConfirmation": [],
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

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const permission = await checkProjectPermission(project.id, undefined, { mode: 'EDIT_STEP', stepType: 'FRAMEWORK' })
  if (!permission.allowed) {
    return permission.response
  }

  if (!(await canExecuteStep(params.id, 'FRAMEWORK'))) {
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
  if (ideationOutput.agentRun && ideationOutput.creativePlanConfirmed !== true) {
    return NextResponse.json(
      { error: 'CREATIVE_PLAN_NOT_CONFIRMED', message: '请先确认完整创作方案，再进入框架搭建' },
      { status: 400 },
    )
  }
  const directions = ideationOutput.directions || []
  const selectedDirection = directions[directionIndex]
  if (!selectedDirection) {
    return NextResponse.json({ error: 'VALID_003' }, { status: 400 })
  }

  // 读取 storyLength，旧项目兼容默认 short
  const storyLength = ideationOutput.storyLength || 'short'

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  if (step.status === 'COMPLETED' && step.outputData) {
    console.log('[FRAMEWORK] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step.outputData, cached: true })
  }

  const pointsCheck = await checkPoints(GENERATION_COSTS.FRAMEWORK + GENERATION_COSTS.FRAMEWORK_DEEPEN_ALL, params.id, 'generation.framework', 'TEXT')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    if (!(await claimStepForGeneration(step.id))) {
      return NextResponse.json(
        { success: true, status: 'PROCESSING', alreadyRunning: true, message: '该步骤的生成任务已在进行中，请等待当前任务完成' },
      )
    }
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
  const businessGoal = outputData?.businessGoal || ''
  const tagInstructions = projectTag && PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS]
    ? PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS].framework
    : ''
  const assetConstraints = await getStepAssetConstraints(params.id, 'FRAMEWORK')
  const goalInstructions = getBusinessGoalPrompt(businessGoal, 'framework')
  const creativePlanInstructions = outputData?.agentRun?.artifacts?.creativePlan
    ? `【用户已确认的完整创作方案】\n${JSON.stringify(outputData.agentRun.artifacts.creativePlan)}`
    : ''
  const combinedInstructions = [goalInstructions, creativePlanInstructions, tagInstructions, assetConstraints.promptBlock].filter(Boolean).join('\n\n')

  const references = await getProjectReferences(params.id).catch(() => [])
  const effectiveReferences = references.filter(r => r.url && r.role !== 'UNASSIGNED')
  const hasRefs = effectiveReferences.length > 0

  let visualRefBlock = ''
  if (hasRefs) {
    const manifest = effectiveReferences.map((reference, index) =>
      `参考图${index + 1}：用途=${reference.role}${reference.targetCharacterId ? `，目标角色=${reference.targetCharacterId}` : ''}${reference.labels.length ? `，标签=${reference.labels.join('、')}` : ''}`
    ).join('\n')
    visualRefBlock = `【参考图职责清单】\n${manifest}\n身份参考只能定义对应角色；风格、环境和构图参考不得贡献人物身份。若身份参考尚未明确目标角色，只能结合用户原始文字中的名称/别名建立候选关系并写入 referenceNeedsConfirmation，不得擅自套给其他角色。】\n`
  }

  const prompt = buildFrameworkPrompt(creativeSource, selectedDirection, storyLength, hasRefs ? visualRefBlock : '', combinedInstructions)
    const textClient = await getTextClient()

    let fullText: string
    if (hasRefs) {
      const refUrls = effectiveReferences.map(r => r.url)
      const refLabels = effectiveReferences.map((reference) => `${reference.role}:${reference.labels.join('、') || reference.title || '未命名'}`)
      console.log(`[FRAMEWORK-VISION] Using multimodal with ${refUrls.length} reference images`)
      fullText = await textClient.generateVision({
        prompt,
        imageUrls: refUrls,
        imageLabels: refLabels,
        temperature: 0.8,
        maxTokens: 16000,
      })
    } else {
      fullText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 16000, model: body.textModel })
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

    const framework = normalizeFrameworkEntities({
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
      visualStyleLayers: fw.visualStyleLayers || undefined,
      productionElements: Array.isArray(fw.productionElements) ? fw.productionElements : [],
      referenceNeedsConfirmation: Array.isArray(fw.referenceNeedsConfirmation) ? fw.referenceNeedsConfirmation : [],
      assetConstraints: assetConstraints.snapshots,
      // 基础框架返回后还会自动完成角色、梗概、幕结构与环境深化。
      // 先写入 queued，副工作台便能把两段工作展示为同一条连续任务。
      deepening: {
        status: 'queued',
        progress: { current: 0, total: 1, phase: '基础框架已保存，等待自动深化' },
        updatedAt: new Date().toISOString(),
      },
    })

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
          await runDeepening(params.id, step.id, framework, projectTag, businessGoal)
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
          createdById: userId,
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
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const permission = await checkProjectPermission(project.id, undefined, { mode: 'EDIT_STEP', stepType: 'FRAMEWORK' })
  if (!permission.allowed) {
    return permission.response
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
