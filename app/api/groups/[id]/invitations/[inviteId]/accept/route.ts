export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/groups/[id]/invitations/[inviteId]/accept
 * 被邀请人接受邀请
 */
export async function POST(_req: Request, { params }: { params: { id: string; inviteId: string } }) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const membership = await prisma.groupMembership.findUnique({
      where: { id: params.inviteId },
    })

    if (!membership || membership.groupId !== params.id || membership.userId !== user.id) {
      return NextResponse.json({ error: 'GROUP_008' }, { status: 404 })
    }

    if (membership.status !== 'INVITED') {
      return NextResponse.json({ error: 'GROUP_009', message: '该邀请状态无效' }, { status: 400 })
    }

    const updated = await prisma.groupMembership.update({
      where: { id: params.inviteId },
      data: { status: 'ACTIVE' },
    })

    return NextResponse.json({ membership: updated })
  } catch (error: any) {
    console.error(`[POST /api/groups/${params.id}/invitations/${params.inviteId}/accept] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
