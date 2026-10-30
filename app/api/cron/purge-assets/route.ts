export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteFile } from '@/lib/r2'

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  const a = Buffer.from(secret)
  const b = Buffer.from(provided)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const now = new Date()
  const [libraryAssets, projectAssets] = await Promise.all([
    prisma.userAsset.findMany({ where: { deletedAt: { not: null }, purgeAfter: { lte: now } }, include: { revisions: { include: { attachments: true } } }, orderBy: { purgeAfter: 'asc' }, take: 100 }),
    prisma.asset.findMany({ where: { deletedAt: { not: null }, purgeAfter: { lte: now }, purgeCompletedAt: null }, include: { bindings: { where: { enabled: true }, select: { id: true } } }, orderBy: { purgeAfter: 'asc' }, take: 100 }),
  ])
  let purgedLibrary = 0
  let purgedProject = 0
  const failures: string[] = []
  for (const asset of libraryAssets) {
    try {
      const keys = new Set<string>([asset.storageKey])
      for (const revision of asset.revisions) {
        if (revision.storageKey) keys.add(revision.storageKey)
        for (const attachment of revision.attachments) keys.add(attachment.storageKey)
      }
      for (const key of keys) await deleteFile(key)
      await prisma.userAsset.delete({ where: { id: asset.id } })
      purgedLibrary++
    } catch (error: any) { failures.push(`library:${asset.id}:${error?.message || 'unknown'}`) }
  }
  for (const asset of projectAssets) {
    if (asset.bindings.length > 0) continue
    try {
      await deleteFile(asset.storageKey)
      await prisma.asset.delete({ where: { id: asset.id } })
      purgedProject++
    } catch (error: any) { failures.push(`project:${asset.id}:${error?.message || 'unknown'}`) }
  }
  return NextResponse.json({ purgedLibrary, purgedProject, failures: failures.slice(0, 20), checkedAt: now.toISOString() }, { status: failures.length ? 207 : 200 })
}
