export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkGroupAdmin } from '@/lib/project-permission'

/**
 * DELETE /api/groups/[id]/members/[userId]
 * 管理员移除成员（不能移除创建者/自己以外的 ADMIN？当前仅允许移除 MEMBER）
 */
export async function DELETE(_req: Request, props: { params: Promise<{ id: string; userId: string }> }) {
  const params = await props.params
  try {
    const adminCheck = await checkGroupAdmin(params.id)
    if (!adminCheck.allowed) return adminCheck.response

    const membership = await prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId: params.id, userId: params.userId } },
    })

    if (!membership) {
      return NextResponse.json({ error: 'GROUP_005' }, { status: 404 })
    }

    // 不允许移除创建者（保留至少一个 ADMIN）
    const group = await prisma.group.findUnique({
      where: { id: params.id },
      select: { createdById: true },
    })
    if (group?.createdById === params.userId) {
      return NextResponse.json({ error: 'GROUP_006', message: '不能移除小组创建者' }, { status: 403 })
    }

    await prisma.groupMembership.delete({
      where: { groupId_userId: { groupId: params.id, userId: params.userId } },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`[DELETE /api/groups/${params.id}/members/${params.userId}] error:`, error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error?.message || '服务器内部错误' },
      { status: 500 }
    )
  }
}
