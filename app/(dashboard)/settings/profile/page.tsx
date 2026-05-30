import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth-helpers'
import { User, Mail, Calendar } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-stone-800">个人信息</h1>
      <p className="mt-1 text-sm text-stone-500">查看和管理你的账号信息</p>

      <div className="mt-6 space-y-6">
        {/* 基本信息卡片 */}
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">基本信息</h2>

          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100">
                <User className="h-5 w-5 text-stone-500" />
              </div>
              <div>
                <p className="text-xs text-stone-500">昵称</p>
                <p className="text-sm font-medium text-stone-800">{user.name || '未设置'}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100">
                <Mail className="h-5 w-5 text-stone-500" />
              </div>
              <div>
                <p className="text-xs text-stone-500">邮箱</p>
                <p className="text-sm font-medium text-stone-800">{user.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100">
                <Calendar className="h-5 w-5 text-stone-500" />
              </div>
              <div>
                <p className="text-xs text-stone-500">注册时间</p>
                <p className="text-sm font-medium text-stone-800">
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '-'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 账号 ID 卡片 */}
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">账号 ID</h2>
          <div className="mt-4">
            <code className="rounded bg-stone-100 px-2 py-1 text-xs text-stone-600">{user.id}</code>
          </div>
        </div>
      </div>
    </div>
  )
}
