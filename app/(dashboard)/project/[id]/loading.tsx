/**
 * 项目详情页 loading 状态
 */
export default function ProjectLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-stone-200" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-64 animate-pulse rounded-lg bg-stone-200" />
        <div className="h-64 animate-pulse rounded-lg bg-stone-200" />
        <div className="h-64 animate-pulse rounded-lg bg-stone-200" />
      </div>
    </div>
  )
}
