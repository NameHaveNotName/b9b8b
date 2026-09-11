export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkGroupAccess } from '@/lib/project-permission'

async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, name: true },
  })
}

/**
 * POST /api/groups/[id]/invitations
 * 普通成员邀请他人加入小组（状态为 INVITED，需对方同意）
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const access = await checkGroupAccess(params.id)
    if (!access.allowed) return access.response

    const body = await req.json().catch(() => ({}))
    const email = body?.email?.trim()
    if (!email) {
      return NextResponse.json({ error: 'VALID_001', message: '缺少用户邮箱' }, { status: 400 })
    }

    const targetUser = await findUserByEmail(email)
    if (!targetUser) {
      return NextResponse.json({ error: 'USER_001', message: '未找到该用户' }, { status: 404 })
    }

    if (targetUser.id === access.user.id) {
      return NextResponse.json({ error: 'VALID_002', message: '不能邀请自己' }, { status: 400 })
    }

    const existing = await prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId: params.id, userId: targetUser.id } },
    })

    if (existing?.status === 'ACTIVE') {
      return NextResponse.json({ error: 'GROUP_004', message: '该用户已是小组成员' }, { status: 409 })
    }

    if (existing?.status === 'INVITED') {
      return NextResponse.json({ error: 'GROUP_007', message: '已发送邀请，请勿重复发送' }, { status: 409 })
    }

    const membership = await prisma.groupMembership.upsert({
      where: { groupId_userId: { groupId: params.id, userId: targetUser.id } },
      create: {
        groupId: params.id,
        userId: targetUser.id,
        role: 'MEMBER',
        status: 'INVITED',
        invitedById: access.user.id,
      },
      update: {
        status: 'INVITED',
        role: 'MEMBER',
        invitedById: access.user.id,
      },
    })

    return NextResponse.json({ membership, user: targetUser })
  } catch (error: any) {
    console.error(`[POST /api/groups/${params.id}/invitations] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
