export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/admin/recharges
 * Admin 查询所有充值订单
 */
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || undefined
    const userId = searchParams.get('userId') || undefined

    const where: any = {}
    if (status) where.status = status
    if (userId) where.userId = userId

    const orders = await prisma.rechargeOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    // 统计
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayOrders = orders.filter((o: any) => o.createdAt >= today)
    const stats = {
      pendingCount: orders.filter((o: any) => o.status === 'pending').length,
      todayAmount: todayOrders
        .filter((o: any) => o.status === 'approved')
        .reduce((sum: number, o: any) => sum + o.amountYuan, 0),
      todayPoints: todayOrders
        .filter((o: any) => o.status === 'approved')
        .reduce((sum: number, o: any) => sum + o.points, 0),
    }

    return NextResponse.json({ orders, stats })
  } catch (e: any) {
    console.error('[ADMIN-RECHARGE] GET error:', e)
    return NextResponse.json({ error: 'SERVER_001', message: e.message }, { status: 500 })
  }
}
