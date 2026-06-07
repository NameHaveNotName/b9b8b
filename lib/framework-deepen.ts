import { prisma } from './prisma'
import { getTextClient } from './api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from './prompts'

function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

export function buildCharacterContext(framework: any, currentCharIndex: number, completedCharacters: any[]) {
  const chars = framework.characters || []
  const summarizedCompleted = completedCharacters.map((c) => ({
    name: c.name,
    role: c.role,
    description: truncateText(c.description, 80),
    ...(c.deepened
      ? {
          appearance: truncateText(c.deepened.appearance, 60),
          personality: truncateText(c.deepened.personality, 60),
          memoryPoints: truncateText(c.deepened.memoryPoints, 40),
        }
      : {}),
  }))

  const otherChars = chars
    .filter((_: any, i: number) => i !== currentCharIndex && !completedCharacters.find((cc) => cc.name === _.name))
    .map((c: any) => ({
      name: c.name,
      role: c.role,
      description: truncateText(c.description, 60),
    }))

  return {
    inspiration: truncateText(framework.inspiration, 200),
    synopsis: truncateText(framework.synopsis, 200),
    styleGuide: truncateText(framework.styleGuide || framework.visualStyle, 100),
    completedCharacters: summarizedCompleted,
    otherCharacters: otherChars,
  }
}

export function buildNarrativeContext(framework: any) {
  const chars = framework.characters || []
  return {
    inspiration: truncateText(framework.inspiration, 200),
    synopsis: truncateText(framework.synopsis, 200),
    styleGuide: truncateText(framework.styleGuide || framework.visualStyle, 100),
    background: truncateText(framework.background, 100),
    characters: chars.map((c: any) => ({
      name: c.name,
      role: c.role,
      description: truncateText(c.description, 80),
      ...(c.deepened
        ? {
            appearance: truncateText(c.deepened.appearance, 50),
            personality: truncateText(c.deepened.personality, 50),
            memoryPoints: truncateText(c.deepened.memoryPoints, 40),
          }
        : {}),
    })),
    storyLength: framework.storyLength,
    totalDuration: framework.totalDuration,
  }
}

export async function updateDeepeningStatus(stepId: string, framework: any, status: string, progress: any) {
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

export async function deepenCharacters(framework: any, stepId: string) {
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
      const context = buildCharacterContext(framework, i, completedCharacters)
      const prompt = loadPromptTemplate('character-deepen', {
        FRAMEWORK: JSON.stringify(context, null, 2),
        COMPLETED_CHARACTERS: JSON.stringify(context.completedCharacters, null, 2),
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
      // 工作指令.txt（2026-06-07）：即使深化失败也要保留 deepened 字段（空值+错误标记），
      // 否则前端 c.deepened 不存在会导致深化区域完全不显示，用户无法区分"未深化"和"深化失败"。
      const failedChar = {
        ...char,
        deepened: {
          appearance: '',
          personality: '',
          catchphrase: '',
          attitudes: {},
          memoryPoints: '',
          _failed: true,
          _error: e.message,
        },
      }
      completedCharacters.push(failedChar)

      const newCharacters = [...(framework.characters || [])]
      newCharacters[i] = failedChar
      framework = { ...framework, characters: newCharacters }
    }
  }

  return framework
}

export async function deepenSynopsis(framework: any, stepId: string) {
  framework = await updateDeepeningStatus(stepId, framework, 'deepening_synopsis', {
    current: 1,
    total: 1,
    phase: '故事梗概深化中',
  })

  try {
    const textClient = await getTextClient()
    const context = buildNarrativeContext(framework)
    const prompt = loadPromptTemplate('synopsis-deepen', {
      FRAMEWORK: JSON.stringify(context, null, 2),
      CHARACTERS: JSON.stringify(context.characters, null, 2),
    })

    const resultText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 6000 })
    const deepenedSynopsis = resultText.trim()

    framework = { ...framework, deepenedSynopsis }
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

export async function deepenActs(framework: any, stepId: string) {
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
      const context = buildNarrativeContext(framework)
      const prompt = loadPromptTemplate('act-deepen', {
        FRAMEWORK: JSON.stringify(context, null, 2),
        CHARACTERS: JSON.stringify(context.characters, null, 2),
        SYNOPSIS: context.synopsis,
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

export async function extractAndDeepenEnvironments(framework: any, stepId: string) {
  framework = await updateDeepeningStatus(stepId, framework, 'extracting_environments', {
    current: 1,
    total: 1,
    phase: '环境提取中',
  })

  try {
    const textClient = await getTextClient()
    const context = buildNarrativeContext(framework)
    const extractPrompt = loadPromptTemplate('environment-extract', {
      FRAMEWORK: JSON.stringify(context, null, 2),
      CHARACTERS: JSON.stringify(context.characters, null, 2),
      ACTS: JSON.stringify((framework.acts || []).map((a: any) => ({
        actNo: a.actNo,
        title: truncateText(a.title, 40),
        content: truncateText(a.content, 100),
        keyScenes: (a.keyScenes || []).slice(0, 3),
      })), null, 2),
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

    const deepenedEnvironments: any[] = []
    for (let i = 0; i < envList.length; i++) {
      const env = envList[i]
      framework = await updateDeepeningStatus(stepId, framework, 'deepening_environments', {
        current: i + 1,
        total: envList.length,
        phase: `环境深化中（${i + 1}/${envList.length}）`,
      })

      try {
        const deepenContext = buildNarrativeContext(framework)
        const deepenPrompt = loadPromptTemplate('environment-deepen', {
          FRAMEWORK: JSON.stringify(deepenContext, null, 2),
          CHARACTERS: JSON.stringify(deepenContext.characters, null, 2),
          ACTS: JSON.stringify((framework.acts || []).map((a: any) => ({
            actNo: a.actNo,
            title: truncateText(a.title, 40),
            content: truncateText(a.content, 100),
            keyScenes: (a.keyScenes || []).slice(0, 3),
          })), null, 2),
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

    framework = { ...framework, environments: deepenedEnvironments }
  } catch (e: any) {
    console.error('[DEEPEN-ENV] 环境提取失败:', e.message)
  }

  return framework
}

export async function runDeepening(projectId: string, stepId: string, initialFramework: any) {
  console.log('[DEEPEN] 开始自动深化流程')
  let framework = initialFramework

  try {
    framework = await deepenCharacters(framework, stepId)
    framework = await deepenSynopsis(framework, stepId)
    framework = await deepenActs(framework, stepId)
    framework = await extractAndDeepenEnvironments(framework, stepId)

    framework = await updateDeepeningStatus(stepId, framework, 'completed', {
      current: 1,
      total: 1,
      phase: '全部深化完成',
    })

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
