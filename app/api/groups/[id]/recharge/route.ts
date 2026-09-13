export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkGroupAdmin } from '@/lib/project-permission'

/**
 * POST /api/groups/[id]/recharge
 * 小组创建者从个人点数转入小组点数池
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const adminCheck = await checkGroupAdmin(params.id)
    if (!adminCheck.allowed) return adminCheck.response

    const body = await req.json().catch(() => ({}))
    const amount = Number(body?.amount)
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'VALID_001', message: '转入点数必须是正整数' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({
        where: { id: adminCheck.user.id },
        select: { id: true, points: true },
      })
      if (!user || user.points < amount) {
        throw new Error('POINTS_001: 个人点数不足')
      }

      const group = await tx.group.findUnique({
        where: { id: params.id },
        select: { id: true, points: true },
      })
      if (!group) {
        throw new Error('GROUP_003: 小组不存在')
      }

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { points: { decrement: amount } },
      })

      const updatedGroup = await tx.group.update({
        where: { id: group.id },
        data: { points: { increment: amount } },
      })

      const transfer = await tx.groupPointTransfer.create({
        data: {
          groupId: group.id,
          userId: user.id,
          amount,
          userAfter: updatedUser.points,
          groupAfter: updatedGroup.points,
        },
      })

      return { transfer, user: updatedUser, group: updatedGroup }
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error(`[POST /api/groups/${params.id}/recharge] error:`, error)
    const message = error?.message || '服务器内部错误'
    if (message.includes('POINTS_001')) {
      return NextResponse.json({ error: 'POINTS_001', message: '个人点数不足' }, { status: 403 })
    }
    return NextResponse.json({ error: 'SERVER_001', message }, { status: 500 })
  }
}
