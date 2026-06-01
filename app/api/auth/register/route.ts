export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * 注册后创建 Prisma User 记录
 * 由前端注册流程调用（signUp 成功后）
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { id, email, name } = body

    if (!id || !email) {
      return NextResponse.json(
        { error: 'VALIDATION_001', message: '缺少 id 或 email' },
        { status: 400 }
      )
    }

    // 创建或更新 Prisma User
    const prismaUser = await prisma.user.upsert({
      where: { id },
      update: {
        email,
        name: name || email.split('@')[0],
      },
      create: {
        id,
        email,
        name: name || email.split('@')[0],
      },
    })

    return NextResponse.json({ success: true, user: prismaUser })
  } catch (error: any) {
    console.error('[POST /api/auth/register] error:', error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error.message },
      { status: 500 }
    )
  }
}
