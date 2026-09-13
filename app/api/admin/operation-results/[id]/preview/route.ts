export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSignedFileUrl } from '@/lib/r2'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentUser()
  if (!admin?.isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  const result = await prisma.operationResult.findUnique({ where: { id } })
  if (!result) return NextResponse.json({ error: 'RESULT_NOT_FOUND' }, { status: 404 })

  if (result.storageKey) {
    const url = await getSignedFileUrl(result.storageKey, 900)
    return NextResponse.json({
      url,
      mimeType: result.mimeType || 'application/octet-stream',
      title: result.title,
      expiresIn: 900,
    })
  }

  if (result.externalUrl && /^https:\/\//i.test(result.externalUrl)) {
    return NextResponse.json({
      url: result.externalUrl,
      mimeType: result.mimeType || 'application/octet-stream',
      title: result.title,
      expiresIn: null,
    })
  }

  return NextResponse.json({ error: 'RESULT_NOT_PREVIEWABLE' }, { status: 404 })
}
