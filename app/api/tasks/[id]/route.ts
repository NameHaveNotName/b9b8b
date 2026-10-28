export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { generationTaskInclude, serializeGenerationTask } from '@/lib/generation-task-view'

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const operation = await prisma.operationLog.findUnique({
    where: { id: params.id },
    include: generationTaskInclude,
  })
  if (!operation) return NextResponse.json({ error: 'TASK_NOT_FOUND' }, { status: 404 })
  if (operation.projectId) {
    const access = await checkProjectPermission(operation.projectId)
    if (!access.allowed) return access.response
  } else if (operation.userId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }
  return NextResponse.json({ task: await serializeGenerationTask(operation) })
}
