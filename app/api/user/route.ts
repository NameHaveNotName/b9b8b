import { NextResponse } from 'next/server'
import { auth, isDemoMode, DEMO_USER } from '@/auth'
import { prisma } from '@/lib/prisma'

/**
 * 获取当前登录用户信息
 * Demo 模式下返回固定 demo 用户
 */
export async function GET() {
  const session = await auth()

  if (!session?.user) {
    if (isDemoMode) {
      return NextResponse.json({ user: DEMO_USER })
    }
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  try {
    const user = session.user.email
      ? await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true, name: true, email: true, image: true },
        })
      : null

    if (user) {
      return NextResponse.json({ user })
    }

    // 数据库找不到但 session 存在，返回 session 中的用户信息
    return NextResponse.json({
      user: {
        id: session.user.id || 'unknown',
        name: session.user.name || null,
        email: session.user.email || null,
        image: session.user.image || null,
      },
    })
  } catch (e) {
    console.error('[GET /api/user] error:', e)
    // 兜底：返回 session 中的用户信息，避免白屏
    return NextResponse.json({
      user: {
        id: session.user.id || 'unknown',
        name: session.user.name || null,
        email: session.user.email || null,
        image: session.user.image || null,
      },
    })
  }
}
