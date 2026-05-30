import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { isDemoMode, DEMO_USER } from "@/lib/demo-mode"

/** 服务端获取当前登录用户（优先 Supabase Auth，回退 Demo 模式）
 *  返回 Prisma User 记录（含业务数据关联）
 */
export async function getCurrentUser() {
  // Demo 模式：返回固定 demo 用户
  if (isDemoMode) {
    return {
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      name: DEMO_USER.name,
      image: DEMO_USER.image,
      emailVerified: null as Date | null,
      createdAt: new Date(),
    }
  }

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
  if (isDemoMode) {
    return DEMO_USER.id
  }

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
