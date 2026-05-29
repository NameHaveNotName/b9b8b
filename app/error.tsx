'use client'

import { useEffect } from 'react'

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
  useEffect(() => {
    console.error('[Error Boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 p-6">
      <h2 className="mb-2 text-xl font-semibold text-stone-800">出错了</h2>
      <p className="mb-4 text-sm text-stone-500">{error.message || '页面加载失败，请刷新重试'}</p>
      <button
        onClick={() => reset()}
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
      >
        重试
      </button>
    </div>
  )
}
