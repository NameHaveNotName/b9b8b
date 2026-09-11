export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/groups/[id]/invitations/[inviteId]/reject
 * 被邀请人拒绝邀请（删除 membership 记录）
 */
export async function POST(_req: Request, props: { params: Promise<{ id: string; inviteId: string }> }) {
  const params = await props.params
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

    await prisma.groupMembership.delete({ where: { id: params.inviteId } })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`[POST /api/groups/${params.id}/invitations/${params.inviteId}/reject] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
