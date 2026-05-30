import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

/**
 * 注册后同步创建 Prisma User 记录
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

    // 验证请求是否来自已认证的 Supabase 用户
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.id !== id) {
      return NextResponse.json(
        { error: 'AUTH_001', message: '未授权' },
        { status: 401 }
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
    console.error('[POST /api/user/sync] error:', error)
    return NextResponse.json(
      { error: 'SERVER_001', message: error.message },
      { status: 500 }
    )
  }
}
