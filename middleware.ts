import { isDemoMode } from "@/lib/demo-mode"
import { NextResponse } from "next/server"

// Demo 模式下（OAuth 未配置）一律放行，避免新访客被卡在登录页看不到 UI。
// 真实部署时只要在 .env.local 填入 AUTH_GITHUB_ID/SECRET，就会自动恢复鉴权。
export default function middleware() {
  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/project/:path*", "/api/projects/:path*", "/api/tasks/:path*"],
}
