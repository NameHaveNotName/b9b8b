export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * PATCH /api/admin/recharges/:id
 * 审核充值订单：通过或拒绝
 */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
      // 条件更新做 CAS：并发审批时只有一个事务能把 pending 抢到 approved，
      // 靠上面的 status 预检 + 无条件 update 会导致双击/多管理员重复加钱
      const claimed = await prisma.rechargeOrder.updateMany({
        where: { id: params.id, status: 'pending' },
        data: { status: 'approved', adminNote: adminNote || null },
      })
      if (claimed.count !== 1) {
        return NextResponse.json(
          { error: 'VALID_002', message: '订单已处理，无法重复审核' },
          { status: 400 }
        )
      }
      await prisma.user.update({
        where: { id: order.userId },
        data: { points: { increment: order.points } },
      })
      console.log(
        `[ADMIN-RECHARGE] 通过订单 ${params.id}, 用户 ${order.userId} +${order.points} 点`
      )
    } else {
      // 拒绝
      const claimed = await prisma.rechargeOrder.updateMany({
        where: { id: params.id, status: 'pending' },
        data: { status: 'rejected', adminNote: adminNote || null },
      })
      if (claimed.count !== 1) {
        return NextResponse.json(
          { error: 'VALID_002', message: '订单已处理，无法重复审核' },
          { status: 400 }
        )
      }
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
