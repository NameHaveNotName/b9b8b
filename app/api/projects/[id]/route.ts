export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        steps: {
          orderBy: { order: 'asc' },
          include: { resultAssets: true },
        },
        assets: { orderBy: { createdAt: 'desc' } },
      },
    })

    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    return NextResponse.json({ project })
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
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const project = await prisma.project.findUnique({ where: { id: params.id } })

    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))

    // 目前仅支持更新 selectedStyleId / title / rawIdea
    const updateData: any = {}
    if (body.selectedStyleId !== undefined) {
      updateData.selectedStyleId = body.selectedStyleId
    }
    if (body.title !== undefined) {
      updateData.title = body.title
    }
    if (body.rawIdea !== undefined) {
      updateData.rawIdea = body.rawIdea
    }

    const updated = await prisma.project.update({
      where: { id: params.id },
      data: updateData,
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
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        assets: { select: { id: true, url: true, storageKey: true } }
      }
    })

    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    const projectId = params.id
    console.log(`[DELETE-PROJECT] 开始删除项目: ${projectId}, 资产数=${project.assets.length}`)

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
