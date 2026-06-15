'use client'

import Link from 'next/link'

/**
 * 路由级错误边界
 * 捕获同一段及子段中的渲染错误，防止白屏
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 p-6">
      <h2 className="mb-2 text-xl font-semibold text-stone-800">出错了</h2>
      <p className="mb-4 text-sm text-stone-500">{error.message || '页面加载失败，请刷新重试'}</p>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          重试
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
        >
          返回仪表盘
        </Link>
      </div>
    </div>
  )
}
