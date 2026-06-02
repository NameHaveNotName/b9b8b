export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * PATCH /api/admin/recharges/:id
 * 审核充值订单：通过或拒绝
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await getCurrentUser()
    if (!admin || !admin.isAdmin) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const { status, adminNote } = body

    if (!status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json(
        { error: 'VALID_001', message: 'status 必须为 approved 或 rejected' },
        { status: 400 }
      )
    }

    const order = await prisma.rechargeOrder.findUnique({
      where: { id: params.id },
    })
    if (!order) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    if (order.status !== 'pending') {
      return NextResponse.json(
        { error: 'VALID_002', message: '订单已处理，无法重复审核' },
        { status: 400 }
      )
    }

    // 通过：给用户加点数
    if (status === 'approved') {
      await prisma.$transaction([
        prisma.rechargeOrder.update({
          where: { id: params.id },
          data: { status: 'approved', adminNote: adminNote || null },
        }),
        prisma.user.update({
          where: { id: order.userId },
          data: { points: { increment: order.points } },
        }),
      ])
      console.log(
        `[ADMIN-RECHARGE] 通过订单 ${params.id}, 用户 ${order.userId} +${order.points} 点`
      )
    } else {
      // 拒绝
      await prisma.rechargeOrder.update({
        where: { id: params.id },
        data: { status: 'rejected', adminNote: adminNote || null },
      })
      console.log(`[ADMIN-RECHARGE] 拒绝订单 ${params.id}, 备注: ${adminNote}`)
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[ADMIN-RECHARGE] PATCH error:', e)
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message },
      { status: 500 }
    )
  }
}
