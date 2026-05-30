import NextAuth, { type Session } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import GitHub from "next-auth/providers/github"
import { prisma } from "@/lib/prisma"

// NextAuth.js v5 (Auth.js) 配置入口
// v5 与 v4 的关键差异：
// 1. 环境变量前缀改为 AUTH_（不再是 NEXTAUTH_）
// 2. 导出 handlers / auth / signIn / signOut，不再需要单独的 API 路由文件写逻辑
// 3. middleware.ts 直接从 "@/auth" 导入 auth 导出

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
export const auth = nextAuth.auth
