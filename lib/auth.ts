import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

/**
 * 认证故障标记。
 *
 * 之前 getCurrentUser/getCurrentUserId 把所有异常都吞成「未登录」：
 * Supabase 或数据库抖动时，与真正的 401 完全无法区分，
 * 会凭空产生 401 和强制跳登录页 —— 这就是「登录状态随机掉线」的根因。
 */
export const AUTH_BACKEND_UNAVAILABLE = "AUTH_BACKEND_UNAVAILABLE" as const

export function isAuthBackendError(err: unknown): boolean {
  return err instanceof Error && err.message === AUTH_BACKEND_UNAVAILABLE
}

/** 服务端获取当前登录用户（优先 Supabase Auth）
 *  不再使用 Demo 模式 fallback，未认证返回 null
 *
 *  @throws 后端不可用时抛 AUTH_BACKEND_UNAVAILABLE，与「未登录」区分开
 */
export async function getCurrentUser() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      // getUser 返回错误说明无法向 Supabase 求证会话（网络/配置故障），
      // 不能当成"没登录"
      throw new Error(`${AUTH_BACKEND_UNAVAILABLE}: ${error.message}`)
    }

    const authUser = data?.user
    if (!authUser?.id) return null

    // 查找或创建 Prisma User 记录
    let user = await prisma.user.findUnique({
      where: { id: authUser.id },
    })

    if (!user) {
      // 首次登录，自动创建 Prisma User 记录
      user = await prisma.user.create({
        data: {
          id: authUser.id,
          email: authUser.email || "",
          name: authUser.user_metadata?.name || authUser.email?.split("@")[0] || "",
          image: authUser.user_metadata?.avatar_url || null,
        },
      })
    }

    return user
  } catch (err) {
    if (isAuthBackendError(err)) throw err
    console.error("[getCurrentUser] 认证后端异常:", err)
    throw new Error(`${AUTH_BACKEND_UNAVAILABLE}: ${(err as Error)?.message || err}`)
  }
}

/**
 * 获取当前用户 ID。
 *
 * @returns 未登录时返回 null
 * @throws 后端不可用时抛 AUTH_BACKEND_UNAVAILABLE（调用方应返回 503 而不是 401）
 */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    throw new Error(`${AUTH_BACKEND_UNAVAILABLE}: ${error.message}`)
  }
  return data?.user?.id || null
}

/** 检查用户是否已登录 */
export async function isAuthenticated(): Promise<boolean> {
  const userId = await getCurrentUserId()
  return !!userId
}
