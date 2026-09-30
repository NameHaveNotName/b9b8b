export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/admin/users/:id/points
 * Admin 手动给用户加点数（可正可负）
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

    if (points < 0 && targetUser.points + points < 0) {
      return NextResponse.json(
        { error: 'VALID_002', message: '扣除后点数不能为负' },
        { status: 400 }
      )
    }

    // 更新用户点数 + 记录操作日志
    // 扣减用带 gte 条件的 updateMany 做原子校验：仅靠上面读到的余额判断，
    // 并发扣减会双双通过预检把余额扣成负数
    const updatedUser = await prisma.$transaction(async (tx: any) => {
      if (points < 0) {
        const deduction = await tx.user.updateMany({
          where: { id: params.id, points: { gte: -points } },
          data: { points: { increment: points } },
        })
        if (deduction.count !== 1) {
          throw new Error('VALID_002: 扣除后点数不能为负')
        }
      } else {
        await tx.user.update({
          where: { id: params.id },
          data: { points: { increment: points } },
        })
      }

      await tx.rechargeOrder.create({
        data: {
          userId: params.id,
          amountYuan: 0,
          points,
          paymentMethod: 'admin_adjust',
          status: 'approved',
          adminNote: reason || `管理员 ${admin.email} 手动调整`,
        },
      })

      return tx.user.findUniqueOrThrow({
        where: { id: params.id },
        select: { points: true },
      })
    })

    console.log(
      `[ADMIN-POINTS] 用户 ${params.id} 点数调整 ${points > 0 ? '+' : ''}${points}, 新余额: ${updatedUser.points}`
    )

    return NextResponse.json({
      success: true,
      newPoints: updatedUser.points,
    })
  } catch (e: any) {
    if (typeof e?.message === 'string' && e.message.startsWith('VALID_002')) {
      return NextResponse.json(
        { error: 'VALID_002', message: '扣除后点数不能为负' },
        { status: 400 }
      )
    }
    console.error('[ADMIN-POINTS] POST error:', e)
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message },
      { status: 500 }
    )
  }
}
