import NextAuth, { type Session } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import GitHub from "next-auth/providers/github"
import { prisma } from "@/lib/prisma"

// NextAuth.js v5 (Auth.js) 配置入口
// v5 与 v4 的关键差异：
// 1. 环境变量前缀改为 AUTH_（不再是 NEXTAUTH_）
// 2. 导出 handlers / auth / signIn / signOut，不再需要单独的 API 路由文件写逻辑
// 3. middleware.ts 直接从 "@/auth" 导入 auth 导出

import { isDemoMode, DEMO_USER } from "@/lib/demo-mode"

const DEMO_SESSION: Session = {
  user: {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
    image: DEMO_USER.image,
  },
  expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
}

const nextAuth = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID || "demo-client-id",
      clientSecret: process.env.AUTH_GITHUB_SECRET || "demo-client-secret",
    }),
    // Email Magic Link 如需开启，保留 Resend 或 Nodemailer 配置占位
  ],
  session: { strategy: "jwt" }, // JWT + 数据库用户数据混合策略
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth

// 包装 auth：
// - 无参数（页面里 `await auth()` 取 session）：demo 模式下直接返回 DEMO_SESSION
// - 其他参数（中间件 / API handler）：透传给 NextAuth 原始实现
type RawAuth = typeof nextAuth.auth
export const auth: RawAuth = ((...args: Parameters<RawAuth>) => {
  if (isDemoMode && (args.length as number) === 0) {
    return Promise.resolve(DEMO_SESSION)
  }
  return (nextAuth.auth as (...a: unknown[]) => unknown)(...args)
}) as RawAuth
