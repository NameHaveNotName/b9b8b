import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

// 受保护的路由前缀
const PROTECTED_PREFIXES = ["/dashboard", "/project", "/settings", "/admin"]

// 这些 API 路由也需要认证
const PROTECTED_API_PREFIXES = ["/api/projects", "/api/tasks"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 检查是否是受保护路由
  const isProtectedRoute = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  )
  const isProtectedApi = PROTECTED_API_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  )

  // Supabase 模式：验证 session
  try {
    const { response, user } = await updateSession(request)

    // 已登录且访问 /login → 重定向到 /dashboard
    if (user && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }

    // 未登录且访问受保护路由 → 重定向到登录页
    if (!user && (isProtectedRoute || isProtectedApi)) {
      // API 路由返回 401
      if (isProtectedApi) {
        return NextResponse.json({ error: "AUTH_001" }, { status: 401 })
      }
      // 页面路由重定向到登录
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("redirect", pathname)
      return NextResponse.redirect(loginUrl)
    }

    return response
  } catch (err) {
    // Supabase 配置异常（如环境变量缺失），未认证用户访问受保护路由时重定向
    console.error("[Middleware] Supabase session error:", err)
    if (!isProtectedRoute && !isProtectedApi) {
      return NextResponse.next()
    }

    // API 路由必须返回 JSON，不能返回 HTML 重定向，否则前端 res.json() 会解析失败
    if (isProtectedApi) {
      return NextResponse.json(
        { error: 'AUTH_001', message: '未登录或服务端认证配置异常' },
        { status: 401 }
      )
    }

    // 受保护页面路由在异常时保守处理：重定向到登录
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(loginUrl)
  }
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/project/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/api/projects/:path*",
    "/api/tasks/:path*",
    "/login",
  ],
}
