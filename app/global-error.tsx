'use client'

/**
 * 全局错误边界（捕获根级错误）
 * 当 error.tsx 无法捕获时使用，必须包含 html/body
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 p-6">
          <h2 className="mb-2 text-xl font-semibold text-stone-800">应用发生严重错误</h2>
          <p className="mb-4 text-sm text-stone-500">{error.message || '请刷新页面或联系管理员'}</p>
          <button
            onClick={() => reset()}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            重试
          </button>
        </div>
      </body>
    </html>
  )
}
