export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkGroupAccess, checkGroupAdmin } from '@/lib/project-permission'

/**
 * GET /api/groups/[id]
 * 获取小组详情（成员、项目、转账记录）
 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const access = await checkGroupAccess(params.id)
    if (!access.allowed) return access.response

    const [group, currentMembership] = await Promise.all([
      prisma.group.findUnique({
        where: { id: params.id },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          members: {
            where: { status: 'ACTIVE' },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            orderBy: { joinedAt: 'asc' },
          },
          projects: {
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              title: true,
              userId: true,
              createdAt: true,
              updatedAt: true,
              _count: { select: { assets: true } },
            },
            orderBy: { updatedAt: 'desc' },
          },
          _count: {
            select: {
              members: { where: { status: 'ACTIVE' } },
              projects: { where: { status: 'ACTIVE' } },
            },
          },
        },
      }),
      prisma.groupMembership.findUnique({
        where: {
          groupId_userId: {
            groupId: params.id,
            userId: access.user.id,
          },
        },
        select: { role: true, status: true },
      }),
    ])

    if (!group) {
      return NextResponse.json({ error: 'GROUP_003' }, { status: 404 })
    }

    return NextResponse.json({ group, currentMembership })
  } catch (error: any) {
    console.error(`[GET /api/groups/${params.id}] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/groups/[id]
 * 修改小组信息（仅创建者/管理员）
 */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const adminCheck = await checkGroupAdmin(params.id)
    if (!adminCheck.allowed) return adminCheck.response

    const body = await req.json().catch(() => ({}))
    const updateData: any = {}

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) {
        return NextResponse.json({ error: 'VALID_001', message: '小组名称不能为空' }, { status: 400 })
      }
      updateData.name = name
    }

    if (body.description !== undefined) {
      updateData.description = body.description?.trim() || null
    }

    if (body.costMode !== undefined) {
      if (body.costMode !== 'MEMBER_PAY' && body.costMode !== 'GROUP_POOL') {
        return NextResponse.json({ error: 'VALID_002', message: 'costMode 必须是 MEMBER_PAY 或 GROUP_POOL' }, { status: 400 })
      }
      updateData.costMode = body.costMode
    }

    const group = await prisma.group.update({
      where: { id: params.id },
      data: updateData,
    })

    return NextResponse.json({ group })
  } catch (error: any) {
    console.error(`[PATCH /api/groups/${params.id}] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/groups/[id]
 * 解散小组（仅创建者）
 */
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const group = await prisma.group.findUnique({
      where: { id: params.id },
      select: { id: true, createdById: true },
    })

    if (!group) {
      return NextResponse.json({ error: 'GROUP_003' }, { status: 404 })
    }

    if (group.createdById !== user.id && !user.isAdmin) {
      return NextResponse.json({ error: 'GROUP_002' }, { status: 403 })
    }

    // 解散：级联删除成员、转账记录；项目 groupId 因 onDelete: SetNull 自动置空
    await prisma.group.delete({ where: { id: params.id } })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`[DELETE /api/groups/${params.id}] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
