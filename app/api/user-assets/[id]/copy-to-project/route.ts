export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { ensureUserAssetsTable } from '@/lib/ensure-user-assets'

const MAX_REFERENCES = 10

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  await ensureUserAssetsTable()

  const body = await req.json().catch(() => ({}))
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  if (!projectId) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })

  const access = await checkProjectPermission(projectId)
  if (!access.allowed) return access.response

  const userAsset = await prisma.userAsset.findFirst({
    where: {
      id: params.id,
      ...(user.isAdmin ? {} : { userId: user.id }),
    },
  })
  if (!userAsset) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })

  const existingCount = await prisma.asset.count({
    where: { projectId, type: 'REFERENCE', stepId: null },
  })
  if (existingCount >= MAX_REFERENCES) {
    return NextResponse.json({ error: 'REFERENCE_LIMIT', message: `项目参考图最多 ${MAX_REFERENCES} 张` }, { status: 400 })
  }

  const asset = await prisma.asset.create({
    data: {
      projectId,
      type: 'REFERENCE',
      mimeType: userAsset.mimeType,
      storageKey: `user-asset:${userAsset.id}`,
      url: userAsset.url,
      metadata: {
        source: 'user-asset-library',
        userAssetId: userAsset.id,
        kind: userAsset.kind,
        title: userAsset.title,
        description: userAsset.description,
      },
    },
  })

  return NextResponse.json({ reference: asset }, { status: 201 })
}
