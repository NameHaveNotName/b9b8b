export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/invitations
 * 获取当前用户收到的待处理邀请
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const invitations = await prisma.groupMembership.findMany({
      where: {
        userId: user.id,
        status: 'INVITED',
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            description: true,
            createdBy: { select: { id: true, name: true, email: true } },
          },
        },
        invitedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ invitations })
  } catch (error: any) {
    console.error('[GET /api/invitations] error:', error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
