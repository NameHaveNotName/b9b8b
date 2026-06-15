import Link from 'next/link'

/**
 * Dashboard 段 404 页面
 */
export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6">
      <h2 className="mb-2 text-2xl font-bold text-stone-800">404</h2>
      <p className="mb-6 text-sm text-stone-500">页面不存在或已被删除</p>
      <Link
        href="/dashboard"
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
      >
        返回仪表盘
      </Link>
    </div>
  )
}
