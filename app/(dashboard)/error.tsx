'use client'

import { useEffect } from 'react'

/**
 * Dashboard 段错误边界
 * 捕获仪表盘及子页面（项目、资产库等）中的渲染错误
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Dashboard Error]', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 p-6">
      <h2 className="mb-2 text-xl font-semibold text-stone-800">页面加载出错</h2>
      <p className="mb-4 max-w-md text-center text-sm text-stone-500">
        {error.message || '仪表盘页面加载失败，请刷新重试'}
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          重试
        </button>
        <a
          href="/dashboard"
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
        >
          返回仪表盘
        </a>
      </div>
    </div>
  )
}
