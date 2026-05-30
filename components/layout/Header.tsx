'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { Bell, User, LogOut } from 'lucide-react'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/project/new': '新建项目',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  if (pathname.startsWith('/project/') && pathname.endsWith('/workflow')) return '工作流看板'
  if (pathname.startsWith('/project/') && pathname.endsWith('/storyboard')) return '分镜编辑器'
  if (pathname.startsWith('/project/') && pathname.endsWith('/assets')) return '资产库'
  if (pathname.startsWith('/project/') && pathname.endsWith('/evaluation')) return '评测对比'
  if (pathname.startsWith('/project/') && pathname.endsWith('/export')) return '导出下载'
  if (pathname.match(/^\/project\/[^\/]+$/)) return '项目总览'
  return ''
}

export default function Header() {
  const pathname = usePathname()
  const title = getPageTitle(pathname || '')
  const { user, signOut } = useAuth()

  return (
    <header className="flex h-16 items-center justify-between border-b border-stone-200 bg-white px-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-stone-800">{title}</h2>
      </div>

      <div className="flex items-center gap-3">
        {/* 通知铃铛（占位） */}
        <button className="relative rounded-md p-2 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600">
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500"></span>
        </button>

        {/* 用户头像 */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100">
          <User className="h-4 w-4 text-stone-500" />
        </div>

        {/* 登出按钮 */}
        {user && (
          <button
            onClick={signOut}
            className="rounded-md p-2 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
            title="登出"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  )
}
