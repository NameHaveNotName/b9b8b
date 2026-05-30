import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const admin = await getCurrentUser()
  if (!admin || !admin.isAdmin) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      name: true,
      points: true,
      isAdmin: true,
      createdAt: true,
      _count: {
        select: {
          projects: true,
          operationLogs: true,
        },
      },
    },
  })

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      points: u.points,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt,
      projectCount: u._count.projects,
      operationCount: u._count.operationLogs,
    })),
  })
}
