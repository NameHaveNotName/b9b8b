export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { projectDetailSelect, projectCoreSelect } from '@/lib/db/project-select'
import { computeProjectStateFromSteps } from '@/lib/workflow-state'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const access = await checkProjectPermission(params.id)
    if (!access.allowed) return access.response
    const { user, isOwner } = access

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: projectDetailSelect,
    })

    if (!project) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    }

    // 兼容旧项目：用 WorkflowStep 的 COMPLETED 状态推导 project.step*_done 字段，
    // 避免因为 stepStyleDone 等布尔字段未写入导致下游步骤被错误锁定。
    const derivedState = computeProjectStateFromSteps(project.steps || [])

    // 从 STYLE 步骤读取用户最近一次选中的风格图比例，作为后续生成的默认比例
    const styleStep = project.steps?.find((s: any) => s.stepType === 'STYLE')
    const styleOutput = (styleStep?.outputData as any) || {}
    const selectedAspectRatio =
      styleOutput?.selectedAspectRatio || styleOutput?.aspectRatio || '16:9'
    const hasSelectedStyle =
      !!project.selectedStyleId ||
      !!styleOutput.selectedStyleId ||
      !!styleOutput.selectedRef ||
      !!styleOutput.styleRefUrl ||
      !!styleOutput.selectedStyleImage ||
      !!styleOutput.selectedStyle?.url

    const projectWithDerivedState = {
      ...project,
      stepIdeaDone: project.stepIdeaDone || derivedState.stepIdeaDone,
      stepFrameworkDone: project.stepFrameworkDone || derivedState.stepFrameworkDone,
      stepStyleDone: project.stepStyleDone || derivedState.stepStyleDone || hasSelectedStyle,
      stepCharacterDone: project.stepCharacterDone || derivedState.stepCharacterDone,
      stepConceptDone: project.stepConceptDone || derivedState.stepConceptDone,
      stepStoryboardDone: project.stepStoryboardDone || derivedState.stepStoryboardDone,
      stepStoryboardFirstframeDone: project.stepStoryboardFirstframeDone || derivedState.stepStoryboardFirstframeDone,
      stepTrailerDone: project.stepTrailerDone || derivedState.stepTrailerDone,
      stepEndingDone: project.stepEndingDone || derivedState.stepEndingDone,
      stepDirectDone: project.stepDirectDone || derivedState.stepDirectDone,
      selectedAspectRatio,
    }

    return NextResponse.json({ project: projectWithDerivedState })
  } catch (error: any) {
    console.error(`[GET /api/projects/${params.id}] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const access = await checkProjectPermission(params.id)
    if (!access.allowed) return access.response
    const { user, isOwner } = access

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: projectCoreSelect,
    })

    if (!project) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))

    // 支持更新 selectedStyleId / title / rawIdea / groupId
    const updateData: any = {}
    if (body.selectedStyleId !== undefined) {
      updateData.selectedStyleId = body.selectedStyleId
      // 兼容路径：选风格图时同步推进 STYLE 步骤的解锁状态，避免下游步骤报"前置未完成"
      if (body.selectedStyleId) {
        updateData.stepStyleDone = true
      }
    }
    if (body.title !== undefined) {
      updateData.title = body.title
    }
    if (body.rawIdea !== undefined) {
      updateData.rawIdea = body.rawIdea
    }

    // 小组成员可把自己的个人项目拉入小组；已属于小组的项目不能移出
    if (body.groupId !== undefined && body.groupId !== project.groupId) {
      if (!isOwner && !user?.isAdmin) {
        return NextResponse.json({ error: 'AUTH_002', message: '只有项目所有者可以移入小组' }, { status: 403 })
      }
      if (project.groupId) {
        return NextResponse.json({ error: 'GROUP_010', message: '项目已属于小组，不能移出' }, { status: 400 })
      }
      if (body.groupId !== null) {
        const membership = await prisma.groupMembership.findUnique({
          where: {
            groupId_userId: {
              groupId: body.groupId,
              userId: user.id,
            },
          },
        })
        if (!membership || membership.status !== 'ACTIVE') {
          return NextResponse.json({ error: 'GROUP_001', message: '你不是该小组成员' }, { status: 403 })
        }
        updateData.groupId = body.groupId
      }
    }

    const updated = await prisma.project.update({
      where: { id: params.id },
      data: updateData,
      select: projectCoreSelect,
    })

    return NextResponse.json({ project: updated })
  } catch (error: any) {
    console.error(`[PATCH /api/projects/${params.id}] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const access = await checkProjectPermission(params.id)
    if (!access.allowed) return access.response
    const { user, isOwner } = access

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: {
        ...projectCoreSelect,
        assets: { select: { id: true, url: true, storageKey: true } }
      }
    })

    if (!project) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    }

    const projectId = params.id
    console.log(`[DELETE-PROJECT] 开始删除项目: ${projectId}, 资产数=${project.assets.length}`)

    // 0. 删除云存储（R2 或 Supabase Storage）中的项目文件夹
    try {
      const { deleteProjectFolder } = await import('@/lib/r2')
      const { deletedCount } = await deleteProjectFolder(projectId)
      console.log(`[DELETE-PROJECT] 云存储清理完成: 删除 ${deletedCount} 个文件`)
    } catch (err: any) {
      console.warn('[DELETE-PROJECT] 云存储清理失败（继续删除项目）:', err?.message)
    }

    // 1. 删除本地 mock-storage 文件（从 asset.url 和 asset.storageKey 推导路径）
    const fsSync = await import('fs')
    const path = await import('path')
    let deletedFiles = 0

    for (const asset of project.assets) {
      // 尝试从 url（如 /mock-storage/projects/xxx/concepts/abc.png）删除
      if (asset.url && asset.url.startsWith('/mock-storage/')) {
        const filePath = path.join(process.cwd(), 'public', asset.url)
        try {
          if (fsSync.existsSync(filePath)) {
            fsSync.unlinkSync(filePath)
            deletedFiles++
          }
        } catch (err: any) {
          console.error('[DELETE-PROJECT] 删除文件失败:', filePath, err.message)
        }
      }
      // 尝试从 storageKey（如 projects/xxx/concepts/abc.png）删除
      if (asset.storageKey) {
        const keyPath = path.join(process.cwd(), 'public', 'mock-storage', asset.storageKey)
        try {
          if (fsSync.existsSync(keyPath)) {
            fsSync.unlinkSync(keyPath)
            deletedFiles++
          }
        } catch (err: any) {
          console.error('[DELETE-PROJECT] 删除文件失败(key):', keyPath, err.message)
        }
      }
    }

    // 2. 删除项目目录（如果存在）
    const projectDir = path.join(process.cwd(), 'public', 'mock-storage', 'projects', projectId)
    try {
      if (fsSync.existsSync(projectDir)) {
        fsSync.rmSync(projectDir, { recursive: true, force: true })
        console.log('[DELETE-PROJECT] 删除项目目录:', projectDir)
      }
    } catch (err: any) {
      console.error('[DELETE-PROJECT] 删除目录失败:', projectDir, err.message)
    }

    // 3. 级联删除数据库记录（Prisma schema 已配置 onDelete: Cascade）
    await prisma.project.delete({ where: { id: projectId } })

    console.log(`[DELETE-PROJECT] 删除完成: ${projectId}, 清理文件=${deletedFiles}`)
    return NextResponse.json({ success: true, message: '项目已删除', deletedFiles })
  } catch (error: any) {
    console.error(`[DELETE /api/projects/${params.id}] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
