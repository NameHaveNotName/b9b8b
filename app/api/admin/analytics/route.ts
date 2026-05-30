import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const admin = await getCurrentUser()
  if (!admin || !admin.isAdmin) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') || '30', 10)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  startDate.setHours(0, 0, 0, 0)

  // 按日统计操作数量
  const dailyOps = await prisma.operationLog.groupBy({
    by: ['createdAt'],
    where: { createdAt: { gte: startDate } },
    _count: { id: true },
    orderBy: { createdAt: 'asc' },
  })

  // 按类型统计
  const typeStats = await prisma.operationLog.groupBy({
    by: ['type'],
    where: { createdAt: { gte: startDate } },
    _count: { id: true },
  })

  // 按成功率统计
  const successStats = await prisma.operationLog.groupBy({
    by: ['success'],
    where: { createdAt: { gte: startDate } },
    _count: { id: true },
  })

  // 汇总数据
  const totalOps = await prisma.operationLog.count({ where: { createdAt: { gte: startDate } } })
  const totalUsers = await prisma.user.count()
  const totalProjects = await prisma.project.count()
  const totalPointsSpent = await prisma.operationLog.aggregate({
    where: { createdAt: { gte: startDate } },
    _sum: { pointsCost: true },
  })

  // 按天聚合（因为 groupBy 返回的是精确时间）
  const dailyMap = new Map<string, number>()
  for (const d of dailyOps) {
    const dateKey = d.createdAt.toISOString().split('T')[0]
    dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + d._count.id)
  }

  const dailyData = Array.from(dailyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    dailyData,
    typeStats: typeStats.map((t) => ({ type: t.type, count: t._count.id })),
    successStats: successStats.map((s) => ({ success: s.success, count: s._count.id })),
    summary: {
      totalOps,
      totalUsers,
      totalProjects,
      totalPointsSpent: totalPointsSpent._sum.pointsCost || 0,
    },
  })
}
