import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export type ProjectPermissionResult =
  | {
      allowed: true
      user: {
        id: string
        email: string
        name: string | null
        image: string | null
        points: number
        isAdmin: boolean
      }
      project: {
        id: string
        userId: string
        groupId: string | null
      }
      isOwner: boolean
    }
  | {
      allowed: false
      response: NextResponse
    }

/**
 * 统一项目权限检查
 *
 * 允许访问的条件（满足任一）：
 * 1. 当前用户是项目所有者 project.userId
 * 2. 当前用户是系统管理员 user.isAdmin
 * 3. 项目属于某个小组，且当前用户是该小组的 ACTIVE 成员
 *
 * 返回结果中包含 isOwner，用于区分所有者/管理员与小组成员的权限差异。
 */
export async function checkProjectPermission(
  projectId: string,
  responseOnFail?: { status: number; error: string }
): Promise<ProjectPermissionResult> {
  const user = await getCurrentUser()
  if (!user) {
    return {
      allowed: false,
      response: NextResponse.json({ error: 'AUTH_001' }, { status: 401 }),
    }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, groupId: true },
  })

  if (!project) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: responseOnFail?.error || 'AUTH_002' },
        { status: responseOnFail?.status || 404 }
      ),
    }
  }

  // 所有者或系统管理员：拥有完全权限
  if (project.userId === user.id || user.isAdmin) {
    return {
      allowed: true,
      user,
      project,
      isOwner: true,
    }
  }

  // 小组项目：检查当前用户是否是该小组的 ACTIVE 成员
  if (project.groupId) {
    const membership = await prisma.groupMembership.findUnique({
      where: {
        groupId_userId: {
          groupId: project.groupId,
          userId: user.id,
        },
      },
    })

    if (membership?.status === 'ACTIVE') {
      return {
        allowed: true,
        user,
        project,
        isOwner: false,
      }
    }
  }

  return {
    allowed: false,
    response: NextResponse.json(
      { error: responseOnFail?.error || 'AUTH_002' },
      { status: responseOnFail?.status || 403 }
    ),
  }
}

export type GroupAccessResult =
  | { allowed: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; membership?: any; isAdmin?: boolean }
  | { allowed: false; response: NextResponse }

/**
 * 检查用户是否可以访问某个小组（是创建者或 ACTIVE 成员）
 */
export async function checkGroupAccess(groupId: string): Promise<GroupAccessResult> {
  const user = await getCurrentUser()
  if (!user) {
    return {
      allowed: false,
      response: NextResponse.json({ error: 'AUTH_001' }, { status: 401 }),
    }
  }

  if (user.isAdmin) {
    return { allowed: true, user }
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      groupId_userId: {
        groupId,
        userId: user.id,
      },
    },
  })

  if (membership?.status === 'ACTIVE') {
    return { allowed: true, user, membership }
  }

  return {
    allowed: false,
    response: NextResponse.json({ error: 'GROUP_001' }, { status: 403 }),
  }
}

export type GroupAdminResult =
  | { allowed: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; membership?: any; isAdmin: boolean }
  | { allowed: false; response: NextResponse }

/**
 * 检查用户是否是小组管理员
 */
export async function checkGroupAdmin(groupId: string): Promise<GroupAdminResult> {
  const user = await getCurrentUser()
  if (!user) {
    return {
      allowed: false,
      response: NextResponse.json({ error: 'AUTH_001' }, { status: 401 }),
    }
  }

  if (user.isAdmin) {
    return { allowed: true, user, isAdmin: true }
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      groupId_userId: {
        groupId,
        userId: user.id,
      },
    },
  })

  if (membership?.status === 'ACTIVE' && membership?.role === 'ADMIN') {
    return { allowed: true, user, membership, isAdmin: false }
  }

  return {
    allowed: false,
    response: NextResponse.json({ error: 'GROUP_002' }, { status: 403 }),
  }
}
