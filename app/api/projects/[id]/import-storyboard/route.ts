export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
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
  const { shots, mode } = body // mode: 'replace' | 'reference'

  if (!shots || !Array.isArray(shots) || shots.length === 0) {
    return NextResponse.json({ error: 'VALID_001', message: '缺少分镜数据' }, { status: 400 })
  }

  if (!mode || !['replace', 'reference'].includes(mode)) {
    return NextResponse.json({ error: 'VALID_002', message: '请选择导入模式：replace（完全替代）或 reference（作为参考）' }, { status: 400 })
  }

  try {
    // 1. 创建/更新 FRAMEWORK 步骤（如果还没有）
    const frameworkStep = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } }
    })

    if (!frameworkStep || frameworkStep.status !== 'COMPLETED') {
      // 如果没有框架，创建一个基本的框架
      const frameworkData = {
        inspiration: '从导入的分镜表中提取',
        styleGuide: '根据分镜表内容推断',
        background: '根据分镜表内容推断',
        characters: [],
        synopsis: '从导入的分镜表中提取',
        storyLength: 'medium',
        totalDuration: `${shots.reduce((sum: number, s: any) => sum + (s.duration || 5), 0).toFixed(1)}秒`,
        acts: [{ actNo: 1, title: '导入的分镜', content: '从Excel分镜表导入', estimatedDuration: `${shots.reduce((sum: number, s: any) => sum + (s.duration || 5), 0).toFixed(1)}秒`, estimatedShots: shots.length, pacing: '根据分镜表推断', keyScenes: [] }],
        environments: [],
        overallPacing: '根据分镜表推断',
      }

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
    }

    // 2. 转换分镜表格式
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

    // 3. 创建提示词
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

    // 4. 更新 STORYBOARD 步骤
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

    // 5. 如果是替代模式，重置后续步骤
    if (mode === 'replace') {
      const subsequentSteps: WorkflowStepType[] = ['KEYFRAMES', 'VIDEO_DIRECT', 'VIDEO_RENDER', 'CAMERA', 'REVIEW']
      await prisma.workflowStep.updateMany({
        where: {
          projectId: params.id,
          stepType: { in: subsequentSteps },
        },
        data: {
          status: 'PENDING',
          outputData: {},
          errorMessage: null,
        },
      })
    }

    // 6. 更新项目的 frameworkSource
    await prisma.project.update({
      where: { id: params.id },
      data: {
        frameworkSource: 'imported',
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
