import { auth, isDemoMode, DEMO_USER } from "@/auth"
import { prisma } from "@/lib/prisma"

/** 服务端获取当前登录用户（含数据库完整记录）
 *  Demo 模式下直接返回固定 demo 用户，避免 session 与数据库 userId 不一致
 */
export async function getCurrentUser() {
  const session = await auth()
  if (!session?.user?.email) return null

  // Demo 模式：统一使用固定 demo 用户，确保创建和查询使用同一个 userId
  if (isDemoMode) {
    return {
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      name: DEMO_USER.name,
      image: DEMO_USER.image,
      emailVerified: null,
      createdAt: new Date(),
    }
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  })
  return user
}

/** 获取当前用户 ID（仅用于需要 userId 的场景）
 *  Demo 模式下固定返回 demo_user_local
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  if (isDemoMode) {
    return DEMO_USER.id
  }

  return session.user.id
}
