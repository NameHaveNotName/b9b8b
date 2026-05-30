import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  if (!user || !user.isAdmin) {
    redirect('/dashboard')
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">管理员后台</h1>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          Admin
        </span>
      </div>
      {children}
    </div>
  )
}
