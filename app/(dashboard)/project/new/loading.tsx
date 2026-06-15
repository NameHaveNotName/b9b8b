/**
 * 新建项目页 loading 状态
 */
export default function NewProjectLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="h-8 w-32 animate-pulse rounded bg-stone-200" />
      <div className="h-40 animate-pulse rounded-xl bg-stone-200" />
      <div className="h-24 animate-pulse rounded-lg bg-stone-200" />
      <div className="h-10 w-32 animate-pulse rounded-lg bg-stone-200" />
    </div>
  )
}
