export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/groups
 * 获取当前用户创建或加入的小组列表
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const memberships = await prisma.groupMembership.findMany({
      where: {
        userId: user.id,
        status: 'ACTIVE',
      },
      include: {
        group: {
          include: {
            _count: {
              select: {
                members: { where: { status: 'ACTIVE' } },
                projects: { where: { status: 'ACTIVE' } },
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    })

    const groups = memberships.map((m: any) => ({
      ...m.group,
      role: m.role,
      memberCount: m.group._count.members,
      projectCount: m.group._count.projects,
    }))

    return NextResponse.json({ groups })
  } catch (error: any) {
    console.error('[GET /api/groups] error:', error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/groups
 * 创建小组，创建者自动成为 ADMIN
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const name = body?.name?.trim()
    if (!name || typeof name !== 'string' || name.length === 0) {
      return NextResponse.json({ error: 'VALID_001', message: '小组名称不能为空' }, { status: 400 })
    }

    const group = await prisma.group.create({
      data: {
        name,
        description: body?.description?.trim() || null,
        createdById: user.id,
        points: 0,
        costMode: body?.costMode === 'GROUP_POOL' ? 'GROUP_POOL' : 'MEMBER_PAY',
        members: {
          create: {
            userId: user.id,
            role: 'ADMIN',
            status: 'ACTIVE',
          },
        },
      },
    })

    return NextResponse.json({ group })
  } catch (error: any) {
    console.error('[POST /api/groups] error:', error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
