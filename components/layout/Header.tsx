'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { Bell, User, LogOut, Settings, ChevronDown } from 'lucide-react'

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

// 简单的下拉菜单组件
function useDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  return { open, setOpen, ref }
}

export default function Header() {
  const pathname = usePathname()
  const title = getPageTitle(pathname || '')
  const { user, signOut } = useAuth()
  const userDropdown = useDropdown()
  const notifDropdown = useDropdown()

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || '用户'
  const userEmail = user?.email || ''
  const userImage = user?.user_metadata?.avatar_url as string | undefined
  const userInitial = (userName[0] || '?').toUpperCase()

  return (
    <header className="flex h-16 items-center justify-between border-b border-stone-200 bg-white px-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-stone-800">{title}</h2>
      </div>

      <div className="flex items-center gap-3">
        {/* 通知铃铛 */}
        <div className="relative" ref={notifDropdown.ref}>
          <button
            onClick={() => notifDropdown.setOpen(!notifDropdown.open)}
            className="relative rounded-md p-2 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
          >
            <Bell className="h-5 w-5" />
            {/* 红点提示 */}
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
          </button>

          {notifDropdown.open && (
            <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-stone-200 bg-white py-2 shadow-lg">
              <div className="px-4 py-2">
                <p className="text-sm font-semibold text-stone-800">通知</p>
              </div>
              <div className="border-t border-stone-100 px-4 py-6 text-center">
                <p className="text-sm text-stone-400">暂无通知</p>
              </div>
            </div>
          )}
        </div>

        {/* 用户菜单 */}
        <div className="relative" ref={userDropdown.ref}>
          <button
            onClick={() => userDropdown.setOpen(!userDropdown.open)}
            className="flex items-center gap-2 rounded-md p-1.5 transition hover:bg-stone-100"
          >
            {userImage ? (
              <img src={userImage} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200 text-xs font-medium text-stone-600">
                {userInitial}
              </div>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
          </button>

          {userDropdown.open && (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-stone-200 bg-white py-2 shadow-lg">
              {/* 用户信息头部 */}
              <div className="px-4 py-3">
                <p className="text-sm font-medium text-stone-800">{userName}</p>
                <p className="text-xs text-stone-500">{userEmail}</p>
              </div>

              <div className="my-1 border-t border-stone-100" />

              {/* 菜单项 */}
              <Link
                href="/settings/profile"
                onClick={() => userDropdown.setOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-stone-600 transition hover:bg-stone-50"
              >
                <User className="h-4 w-4" />
                个人信息
              </Link>
              <Link
                href="/settings"
                onClick={() => userDropdown.setOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-stone-600 transition hover:bg-stone-50"
              >
                <Settings className="h-4 w-4" />
                账号设置
              </Link>

              <div className="my-1 border-t border-stone-100" />

              <button
                onClick={() => {
                  userDropdown.setOpen(false)
                  signOut()
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 transition hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
