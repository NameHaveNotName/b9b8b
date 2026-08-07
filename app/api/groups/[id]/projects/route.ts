export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { WorkflowStepType } from '@prisma/client'
import { projectCoreSelect } from '@/lib/db/project-select'
import { checkGroupAccess } from '@/lib/project-permission'

/**
 * POST /api/groups/[id]/projects
 * 在小组内创建项目（自动绑定 groupId）
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const access = await checkGroupAccess(params.id)
    if (!access.allowed) return access.response

    const body = await req.json().catch(() => ({}))
    const title = body?.title || body?.rawIdea
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'VALID_001', message: '项目标题不能为空' }, { status: 400 })
    }

    const trimmedTitle = title.trim()

    const project = await prisma.project.create({
      data: {
        userId: access.user.id,
        groupId: params.id,
        title: trimmedTitle,
        rawIdea: body?.rawIdea && typeof body.rawIdea === 'string' ? body.rawIdea : '',
        status: 'ACTIVE',
      },
      select: projectCoreSelect,
    })

    const stepTypes: WorkflowStepType[] = [
      'IDEATION', 'FRAMEWORK', 'STYLE', 'CHARACTER', 'CONCEPT', 'TRAILER',
      'STORYBOARD', 'KEYFRAMES', 'VIDEO_DIRECT', 'VIDEO_RENDER', 'CAMERA', 'REVIEW',
    ]
    await prisma.workflowStep.createMany({
      data: stepTypes.map((stepType, index) => ({
        projectId: project.id,
        stepType,
        order: index,
        status: 'PENDING',
      })),
    })

    return NextResponse.json({ project })
  } catch (error: any) {
    console.error(`[POST /api/groups/${params.id}/projects] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
