export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { extractJsonFromMarkdown } from '@/lib/prompts'
import { WorkflowStepType } from '@prisma/client'

interface StoryboardShot {
  shotId: string
  timecode?: string
  duration?: number
  narration?: string
  cameraMove?: string
  description: string
  visualDetail?: string
  transition?: string
}

const EXTRACT_FRAMEWORK_PROMPT = `角色：高端艺术电影 AI 编剧与结构顾问

目标：从用户提供的分镜表中，提取关键信息并生成完整的故事框架。

【任务说明】
用户提供了一个完整的分镜表，你需要：
1. 分析所有分镜的内容，提取故事主题、角色、场景等信息
2. 生成完整的故事框架（包括灵感阐释、风格规范、背景设定、角色设定等）
3. 为后续的风格统一和人物设计生成提示词

【输出格式】（严格 JSON，不要 Markdown 代码块）
{
  "framework": {
    "inspiration": "灵感阐释：从分镜表中提取的故事主题和核心表达...",
    "styleGuide": "风格规范：从分镜表中推断的视觉风格和画面要求...",
    "background": "背景环境设定：从分镜表中提取的时代背景和环境设定...",
    "characters": [
      {
        "id": "char_001",
        "name": "角色名",
        "role": "主角/配角",
        "description": "从分镜表中提取的角色描述..."
      }
    ],
    "synopsis": "用一段话概括整个故事的核心冲突和结局...",
    "storyLength": "根据分镜数量和总时长判断：sketch/short/medium/feature/epic",
    "totalDuration": "总时长",
    "acts": [
      {
        "actNo": 1,
        "title": "幕标题",
        "content": "该幕的内容概述...",
        "estimatedDuration": "该幕预估时长",
        "estimatedShots": 15,
        "pacing": "节奏策略",
        "keyScenes": ["核心场景1", "核心场景2"]
      }
    ],
    "environments": ["环境1", "环境2"],
    "overallPacing": "整体节奏策略说明..."
  },
  "stylePrompt": "为风格统一生成的英文提示词，描述整体视觉风格...",
  "characterPrompts": [
    {
      "characterId": "char_001",
      "characterName": "角色名",
      "prompt": "为人物设计生成的英文提示词，描述角色外观..."
    }
  ]
}

【分镜表内容】
{{STORYBOARD_CONTENT}}`

// 重试配置
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 5000

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
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
  const { shots, mode } = body // mode: 'ai_complete' | 'skip_framework'

  if (!shots || !Array.isArray(shots) || shots.length === 0) {
    return NextResponse.json({ error: 'VALID_001', message: '缺少分镜数据' }, { status: 400 })
  }

  if (!mode || !['ai_complete', 'skip_framework'].includes(mode)) {
    return NextResponse.json({ error: 'VALID_002', message: '请选择导入模式' }, { status: 400 })
  }

  try {
    // 1. 转换分镜表格式
    const convertedShots = shots.map((shot: StoryboardShot, index: number) => ({
      shotId: shot.shotId || `shot_${String(index + 1).padStart(3, '0')}`,
      actNumber: 1,
      description: shot.description,
      cameraMove: shot.cameraMove || '固定',
      duration: shot.duration || 5,
      narration: shot.narration || '',
      characters: [],
      sceneName: '',
      visualDetail: shot.visualDetail || '',
      transition: shot.transition || '',
    }))

    // 2. 创建提示词（基础版本，后续可由 AI 优化）
    const prompts = convertedShots.map((shot: any, i: number) => ({
      id: `prompt_act${shot.actNumber}_${shot.shotId}`,
      chineseDesc: shot.description,
      englishPrompt: `${shot.cameraMove} | ${shot.duration}s | ${shot.description}`,
      target: `act${shot.actNumber}_${shot.shotId}`,
      shotId: shot.shotId,
      actNumber: shot.actNumber,
      cameraMove: shot.cameraMove,
      duration: shot.duration,
      characters: shot.characters,
      sceneName: shot.sceneName,
    }))

    // 3. 更新 STORYBOARD 步骤
    const storyboardStep = await prisma.workflowStep.upsert({
      where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } },
      create: {
        projectId: params.id,
        stepType: 'STORYBOARD',
        status: 'PENDING',
        order: 6,
        outputData: {
          prompts,
          shots: convertedShots,
          mode: 'keyframe',
          importedFrom: 'excel',
          importMode: mode,
        },
      },
      update: {
        status: 'PENDING',
        outputData: {
          prompts,
          shots: convertedShots,
          mode: 'keyframe',
          importedFrom: 'excel',
          importMode: mode,
        },
        errorMessage: null,
      },
    })

    // 4. 根据模式处理
    if (mode === 'ai_complete') {
      // AI 补完模式：调用 LLM 生成框架和提示词
      const storyboardContent = shots.map((s: StoryboardShot) =>
        `镜头${s.shotId}：${s.description}${s.cameraMove ? `（运镜：${s.cameraMove}）` : ''}${s.narration ? `【旁白：${s.narration}】` : ''}`
      ).join('\n')

      let lastError: Error | null = null
      let frameworkData: any = null
      let stylePrompt = ''
      let characterPrompts: any[] = []

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[IMPORT-STORYBOARD] AI补完重试第 ${attempt} 次`)
            await sleep(RETRY_DELAY_MS * attempt)
          }

          const textClient = await getTextClient()
          const prompt = EXTRACT_FRAMEWORK_PROMPT.replace('{{STORYBOARD_CONTENT}}', storyboardContent)

          console.log('[IMPORT-STORYBOARD] 开始AI补完，attempt:', attempt + 1)
          const resultText = await textClient.generate(prompt, {
            temperature: 0.3,
            maxTokens: 12000,
          })

          const parsed = extractJsonFromMarkdown(resultText)

          if (parsed.framework) {
            frameworkData = parsed.framework
            stylePrompt = parsed.stylePrompt || ''
            characterPrompts = parsed.characterPrompts || []
            break
          }
        } catch (e: any) {
          lastError = e
          console.error(`[IMPORT-STORYBOARD] AI补完 attempt ${attempt + 1} 失败:`, e.message)
        }
      }

      if (frameworkData) {
        // 更新 FRAMEWORK 步骤
        await prisma.workflowStep.upsert({
          where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } },
          create: {
            projectId: params.id,
            stepType: 'FRAMEWORK',
            status: 'COMPLETED',
            order: 1,
            outputData: frameworkData,
          },
          update: {
            status: 'COMPLETED',
            outputData: frameworkData,
            errorMessage: null,
          },
        })

        // 更新 STYLE 步骤（提示词）
        await prisma.workflowStep.upsert({
          where: { projectId_stepType: { projectId: params.id, stepType: 'STYLE' } },
          create: {
            projectId: params.id,
            stepType: 'STYLE',
            status: 'PENDING',
            order: 2,
            outputData: { stylePrompt, generatedFrom: 'storyboard_import' },
          },
          update: {
            status: 'PENDING',
            outputData: { stylePrompt, generatedFrom: 'storyboard_import' },
            errorMessage: null,
          },
        })

        // 更新 CHARACTER 步骤（提示词）
        await prisma.workflowStep.upsert({
          where: { projectId_stepType: { projectId: params.id, stepType: 'CHARACTER' } },
          create: {
            projectId: params.id,
            stepType: 'CHARACTER',
            status: 'PENDING',
            order: 3,
            outputData: { characterPrompts, generatedFrom: 'storyboard_import' },
          },
          update: {
            status: 'PENDING',
            outputData: { characterPrompts, generatedFrom: 'storyboard_import' },
            errorMessage: null,
          },
        })

        // 更新 IDEATION 步骤（标记完成）
        await prisma.workflowStep.upsert({
          where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } },
          create: {
            projectId: params.id,
            stepType: 'IDEATION',
            status: 'COMPLETED',
            order: 0,
            outputData: {
              directions: [{ title: '从分镜表导入', description: '用户提供了完整的分镜表' }],
              storyLength: frameworkData.storyLength || 'medium',
              storyLengthLabel: '用户定义',
            },
          },
          update: {
            status: 'COMPLETED',
            outputData: {
              directions: [{ title: '从分镜表导入', description: '用户提供了完整的分镜表' }],
              storyLength: frameworkData.storyLength || 'medium',
              storyLengthLabel: '用户定义',
            },
            errorMessage: null,
          },
        })

        console.log('[IMPORT-STORYBOARD] AI补完成功')
      } else {
        // AI 补完失败，使用默认框架
        console.warn('[IMPORT-STORYBOARD] AI补完失败，使用默认框架')
        await createDefaultFramework(params.id, shots, convertedShots)
      }
    } else {
      // skip_framework 模式：跳过中间步骤
      // 标记 IDEATION、FRAMEWORK、STYLE、CHARACTER、CONCEPT、TRAILER 为 SKIPPED
      const stepsToSkip: WorkflowStepType[] = ['IDEATION', 'FRAMEWORK', 'STYLE', 'CHARACTER', 'CONCEPT', 'TRAILER']
      for (const stepType of stepsToSkip) {
        await prisma.workflowStep.upsert({
          where: { projectId_stepType: { projectId: params.id, stepType } },
          create: {
            projectId: params.id,
            stepType,
            status: 'SKIPPED',
            order: getStepOrder(stepType),
            outputData: { skipped: true, reason: '用户导入分镜表并选择跳过框架' },
          },
          update: {
            status: 'SKIPPED',
            outputData: { skipped: true, reason: '用户导入分镜表并选择跳过框架' },
            errorMessage: null,
          },
        })
      }
    }

    // 5. 更新项目的 frameworkSource
    await prisma.project.update({
      where: { id: params.id },
      data: {
        frameworkSource: 'imported',
        rawIdea: project.rawIdea || shots.map((s: StoryboardShot) => s.description).join('\n'),
      },
    })

    console.log(`[IMPORT-STORYBOARD] 成功导入 ${shots.length} 个分镜，模式: ${mode}`)

    return NextResponse.json({
      success: true,
      shotsCount: shots.length,
      mode,
      storyboardStepId: storyboardStep.id,
    })
  } catch (e: any) {
    console.error('[IMPORT-STORYBOARD] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}

async function createDefaultFramework(projectId: string, shots: StoryboardShot[], convertedShots: any[]) {
  const totalDuration = shots.reduce((sum, s) => sum + (s.duration || 5), 0)
  const frameworkData = {
    inspiration: '从导入的分镜表中提取的故事主题',
    styleGuide: '根据分镜表内容推断的视觉风格',
    background: '根据分镜表内容推断的背景设定',
    characters: [],
    synopsis: '从导入的分镜表中提取的故事梗概',
    storyLength: 'medium',
    totalDuration: `${totalDuration.toFixed(1)}秒`,
    acts: [{
      actNo: 1,
      title: '导入的分镜',
      content: '从Excel分镜表导入',
      estimatedDuration: `${totalDuration.toFixed(1)}秒`,
      estimatedShots: shots.length,
      pacing: '根据分镜表推断',
      keyScenes: [],
    }],
    environments: [],
    overallPacing: '根据分镜表推断',
  }

  await prisma.workflowStep.upsert({
    where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
    create: {
      projectId,
      stepType: 'FRAMEWORK',
      status: 'COMPLETED',
      order: 1,
      outputData: frameworkData,
    },
    update: {
      status: 'COMPLETED',
      outputData: frameworkData,
      errorMessage: null,
    },
  })
}

function getStepOrder(stepType: WorkflowStepType): number {
  const orderMap: Record<string, number> = {
    'IDEATION': 0,
    'FRAMEWORK': 1,
    'STYLE': 2,
    'CHARACTER': 3,
    'CONCEPT': 4,
    'TRAILER': 5,
    'STORYBOARD': 6,
    'KEYFRAMES': 7,
    'VIDEO_DIRECT': 8,
    'VIDEO_RENDER': 9,
    'CAMERA': 10,
    'REVIEW': 11,
  }
  return orderMap[stepType] || 0
}
