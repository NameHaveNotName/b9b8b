export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { PlusCircle, Users, FolderOpen } from 'lucide-react'

export default async function GroupsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await prisma.groupMembership.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    include: {
      group: {
        include: {
          _count: {
            select: {
              members: { where: { status: 'ACTIVE' } },
              projects: { where: { status: 'ACTIVE' } },
            },
          },
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  })

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-800">我的小组</h1>
          <p className="mt-1 text-sm text-stone-500">与团队成员协作共创项目</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/invitations"
            className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
          >
            我的邀请
          </Link>
          <Link
            href="/groups/new"
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800"
          >
            <PlusCircle className="h-4 w-4" />
            创建小组
          </Link>
        </div>
      </div>

      {memberships.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100">
            <Users className="h-7 w-7 text-stone-400" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-stone-700">还没有加入任何小组</h3>
          <p className="mt-1 max-w-sm text-sm text-stone-500">创建小组并邀请成员，或接受他人邀请开始协作</p>
          <Link
            href="/groups/new"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
          >
            <PlusCircle className="h-4 w-4" />
            创建小组
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {memberships.map((m: any) => (
            <Link
              key={m.group.id}
              href={`/groups/${m.group.id}`}
              className="group rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-stone-800 group-hover:text-stone-900">{m.group.name}</h3>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500">
                  {m.role === 'ADMIN' ? '管理员' : '成员'}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-stone-500">{m.group.description || '暂无描述'}</p>
              <div className="mt-4 flex items-center gap-4 text-xs text-stone-400">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {m.group._count.members} 成员
                </span>
                <span className="inline-flex items-center gap-1">
                  <FolderOpen className="h-3 w-3" />
                  {m.group._count.projects} 项目
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
