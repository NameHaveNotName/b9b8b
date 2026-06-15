/**
 * 全局 loading 状态
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-amber-600" />
        <p className="text-sm text-stone-500">页面加载中...</p>
      </div>
    </div>
  )
}
