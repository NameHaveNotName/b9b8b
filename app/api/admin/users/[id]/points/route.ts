export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/admin/users/:id/points
 * Admin 手动给用户加点数（可正可负）
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await getCurrentUser()
    if (!admin || !admin.isAdmin) {
      return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const { points, reason } = body

    if (typeof points !== 'number' || points === 0) {
      return NextResponse.json(
        { error: 'VALID_001', message: 'points 必须是非零数字' },
        { status: 400 }
      )
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
    })
    if (!targetUser) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }

    // 扣除时检查余额
    if (points < 0 && targetUser.points + points < 0) {
      return NextResponse.json(
        { error: 'VALID_002', message: '扣除后点数不能为负' },
        { status: 400 }
      )
    }

    // 更新用户点数 + 记录操作日志
    const [updatedUser, _order] = await prisma.$transaction([
      prisma.user.update({
        where: { id: params.id },
        data: { points: { increment: points } },
      }),
      prisma.rechargeOrder.create({
        data: {
          userId: params.id,
          amountYuan: 0,
          points,
          paymentMethod: 'admin_adjust',
          status: 'approved',
          adminNote: reason || `管理员 ${admin.email} 手动调整`,
        },
      }),
    ])

    console.log(
      `[ADMIN-POINTS] 用户 ${params.id} 点数调整 ${points > 0 ? '+' : ''}${points}, 新余额: ${updatedUser.points}`
    )

    return NextResponse.json({
      success: true,
      newPoints: updatedUser.points,
    })
  } catch (e: any) {
    console.error('[ADMIN-POINTS] POST error:', e)
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message },
      { status: 500 }
    )
  }
}
