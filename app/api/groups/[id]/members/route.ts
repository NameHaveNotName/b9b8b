export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkGroupAdmin } from '@/lib/project-permission'

async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, name: true },
  })
}

/**
 * POST /api/groups/[id]/members
 * 管理员直接添加成员（立即 ACTIVE）
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const adminCheck = await checkGroupAdmin(params.id)
    if (!adminCheck.allowed) return adminCheck.response

    const body = await req.json().catch(() => ({}))
    const email = body?.email?.trim()
    if (!email) {
      return NextResponse.json({ error: 'VALID_001', message: '缺少用户邮箱' }, { status: 400 })
    }

    const targetUser = await findUserByEmail(email)
    if (!targetUser) {
      return NextResponse.json({ error: 'USER_001', message: '未找到该用户' }, { status: 404 })
    }

    if (targetUser.id === adminCheck.user.id) {
      return NextResponse.json({ error: 'VALID_002', message: '不能添加自己' }, { status: 400 })
    }

    const existing = await prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId: params.id, userId: targetUser.id } },
    })

    if (existing?.status === 'ACTIVE') {
      return NextResponse.json({ error: 'GROUP_004', message: '该用户已是小组成员' }, { status: 409 })
    }

    const membership = await prisma.groupMembership.upsert({
      where: { groupId_userId: { groupId: params.id, userId: targetUser.id } },
      create: {
        groupId: params.id,
        userId: targetUser.id,
        role: 'MEMBER',
        status: 'ACTIVE',
        invitedById: adminCheck.user.id,
      },
      update: {
        status: 'ACTIVE',
        role: 'MEMBER',
        invitedById: adminCheck.user.id,
      },
    })

    return NextResponse.json({ membership, user: targetUser })
  } catch (error: any) {
    console.error(`[POST /api/groups/${params.id}/members] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
