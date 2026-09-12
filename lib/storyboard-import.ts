/**
 * 分镜导入共用逻辑
 *
 * 从 import-storyboard route 提取，供多个 API 共用。
 */

import { prisma } from '@/lib/prisma'
import { WorkflowStepType } from '@prisma/client'

export interface ImportShotsOptions {
  projectId: string
  shots: Array<{
    shotId: string
    timecode?: string
    duration?: number
    narration?: string
    cameraMove?: string
    description: string
    visualDetail?: string
    transition?: string
  }>
  mode: 'ai_complete' | 'skip_framework'
  firstFrameMap?: Record<string, { url: string; assetId?: string }>
}

export async function importStoryboardShots(options: ImportShotsOptions) {
  const { projectId, shots, mode, firstFrameMap } = options

  // 1. 转换分镜表格式
  const convertedShots = shots.map((shot, index) => ({
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
    // 如果有首帧图，附加到 shot 上
    ...(firstFrameMap?.[shot.shotId]
      ? {
          firstFrameUrl: firstFrameMap[shot.shotId].url,
          firstFrameAssetId: firstFrameMap[shot.shotId].assetId,
        }
      : {}),
  }))

  // 2. 创建提示词
  const prompts = convertedShots.map((shot: any) => ({
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
  await prisma.workflowStep.upsert({
    where: { projectId_stepType: { projectId, stepType: 'STORYBOARD' } },
    create: {
      projectId,
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

  // 4. 根据模式处理其他步骤
  if (mode === 'skip_framework') {
    const stepsToSkip: WorkflowStepType[] = ['IDEATION', 'FRAMEWORK', 'STYLE', 'CHARACTER', 'CONCEPT', 'TRAILER']
    for (const stepType of stepsToSkip) {
      await prisma.workflowStep.upsert({
        where: { projectId_stepType: { projectId, stepType } },
        create: {
          projectId,
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
  } else {
    // ai_complete 模式：标记 IDEATION 完成
    await prisma.workflowStep.upsert({
      where: { projectId_stepType: { projectId, stepType: 'IDEATION' } },
      create: {
        projectId,
        stepType: 'IDEATION',
        status: 'COMPLETED',
        order: 0,
        outputData: {
          directions: [{ title: '从分镜表导入', description: '用户提供了完整的分镜表' }],
          storyLength: 'medium',
          storyLengthLabel: '用户定义',
        },
      },
      update: {
        status: 'COMPLETED',
        outputData: {
          directions: [{ title: '从分镜表导入', description: '用户提供了完整的分镜表' }],
          storyLength: 'medium',
          storyLengthLabel: '用户定义',
        },
        errorMessage: null,
      },
    })
  }

  // 5. 更新项目的 frameworkSource
  await prisma.project.update({
    where: { id: projectId },
    data: {
      frameworkSource: 'imported',
      rawIdea: shots.map(s => s.description).join('\n'),
    },
  })

  return { shotsCount: shots.length, mode }
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
