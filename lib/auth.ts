import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

/** 服务端获取当前登录用户（优先 Supabase Auth）
 *  不再使用 Demo 模式 fallback，未认证返回 null
 */
export async function getCurrentUser() {
  try {
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

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
    console.error("[getCurrentUser] Supabase auth error:", err)
    return null
  }
}

/** 获取当前用户 ID */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id || null
  } catch {
    return null
  }
}

/** 检查用户是否已登录 */
export async function isAuthenticated(): Promise<boolean> {
  const userId = await getCurrentUserId()
  return !!userId
}
