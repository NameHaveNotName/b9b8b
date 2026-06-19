import { NextResponse } from 'next/server'
import { getCurrentUser, getCurrentUserId } from "@/lib/auth"

/** 服务端获取当前登录用户（含数据库完整记录）
 *  兼容 Supabase Auth 和 Demo 模式
 */
export { getCurrentUser, getCurrentUserId }

/**
 * 项目访问权限检查：所有者或管理员可访问
 * 返回 { allowed: true } 或 { allowed: false, response: NextResponse }
 */
export async function checkProjectAccess(
  projectUserId: string,
  responseOnFail?: { status: number; error: string }
) {
  const user = await getCurrentUser()
  if (!user) {
    return {
      allowed: false,
      response: NextResponse.json({ error: 'AUTH_001' }, { status: 401 }),
    }
  }
  if (projectUserId !== user.id && !user.isAdmin) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: responseOnFail?.error || 'AUTH_002' },
        { status: responseOnFail?.status || 403 }
      ),
    }
  }
  return { allowed: true, user }
}
