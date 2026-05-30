import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

/**
 * 获取当前登录用户信息
 * 兼容 Supabase Auth 和 Demo 模式
 */
export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        isAdmin: user.isAdmin,
        points: user.points,
      },
    })
  } catch (error: any) {
    console.error('[GET /api/user] error:', error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error.message },
      { status: 500 }
    )
  }
}
