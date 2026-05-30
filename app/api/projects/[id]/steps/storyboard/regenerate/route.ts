import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import sharp from 'sharp'
import { IMAGE_MODELS, MODEL_SIZE_MAP } from '@/lib/models-config'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { shotId, aspectRatio, imageModel } = body
  if (!shotId || typeof shotId !== 'string') {
    return NextResponse.json({ error: 'VALIDATION_001', message: '缺少 shotId' }, { status: 400 })
  }
  const newRatio = aspectRatio || '16:9'
  const newModel = imageModel || IMAGE_MODELS.primary
  console.log(`[REGENERATE-PARAMS] storyboard: ${shotId}, 新比例: ${newRatio}, 新模型: ${newModel}`)

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData || {}) as any
  const shots: any[] = outputData.shots || []
  const shotAssets: any[] = outputData.shotAssets || []

  const targetIndex = shots.findIndex((s: any) => s.shotId === shotId)
  if (targetIndex < 0) {
    return NextResponse.json({ error: 'NOT_FOUND', message: '未找到该分镜' }, { status: 404 })
  }

  const targetShot = shots[targetIndex]
  console.log(`[STORYBOARD-REGENERATE] 重新生成分镜草图: shotId=${shotId}`)

  // 删除旧 Asset
  const oldAssetEntry = shotAssets.find((a: any) => a.shotId === shotId)
  if (oldAssetEntry?.assetId) {
    try {
      await prisma.asset.delete({ where: { id: oldAssetEntry.assetId } })
      console.log('[STORYBOARD-REGENERATE] 旧 Asset 已删除:', oldAssetEntry.assetId)
    } catch (e: any) {
      console.warn('[STORYBOARD-REGENERATE] 删除旧 Asset 失败:', e?.message)
    }
  }

  try {
    const charColors = (targetShot.characters || []).map((cid: string, idx: number) => {
      const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6']
      return { id: cid, color: colors[idx % colors.length] }
    })

    // Resolve size from aspect ratio using MODEL_SIZE_MAP
    const modelSizes = MODEL_SIZE_MAP[newModel]
    const [svgW, svgH] = (modelSizes?.[newRatio] || '1024x576').split('x').map(Number)

    const safeDesc = (targetShot.description || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

    const svg = `
      <svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f8f9fa"/>
        <text x="50%" y="10%" font-family="system-ui, sans-serif" font-size="24" fill="#333" text-anchor="middle">分镜 ${targetShot.shotId}</text>
        <text x="50%" y="20%" font-family="system-ui, sans-serif" font-size="16" fill="#666" text-anchor="middle">${targetShot.cameraMove || '固定'} | 第${targetShot.actNumber}幕 | ${targetShot.duration || 5}秒 | ${newRatio}</text>
        ${charColors.map((c: any, i: number) =>
          `<circle cx="${200 + i * 300}" cy="300" r="80" fill="${c.color}" opacity="0.3" stroke="${c.color}" stroke-width="4"/>
           <text x="${200 + i * 300}" y="300" font-family="system-ui, sans-serif" font-size="20" fill="${c.color}" text-anchor="middle" dy=".3em">角色${i + 1}</text>`
        ).join('')}
        <rect x="50" y="450" width="${svgW - 100}" height="80" fill="none" stroke="#333" stroke-width="2" stroke-dasharray="8,4"/>
        <text x="50%" y="490" font-family="system-ui, sans-serif" font-size="14" fill="#333" text-anchor="middle">${safeDesc}</text>
      </svg>
    `
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer()

    const storageKey = `projects/${params.id}/storyboard/${targetShot.shotId}.png`
    await uploadFile(storageKey, buffer, 'image/png')
    const url = await getSignedFileUrl(storageKey, 3600)

    const newAsset = await prisma.asset.create({
      data: {
        projectId: params.id,
        stepId: step.id,
        type: 'IMAGE',
        mimeType: 'image/png',
        storageKey,
        url,
        metadata: {
          shotId: targetShot.shotId,
          type: 'storyboard',
          characters: targetShot.characters,
          duration: targetShot.duration,
          actNumber: targetShot.actNumber,
          aspectRatio: newRatio,
          imageModel: newModel,
          regenerated: true,
        },
      },
    })

    const newShotAssets = shotAssets.filter((a: any) => a.shotId !== shotId)
    newShotAssets.push({ shotId: targetShot.shotId, assetId: newAsset.id })

    await prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        outputData: {
          ...outputData,
          shotAssets: newShotAssets,
        },
      },
    })

    console.log('[STORYBOARD-REGENERATE] 重新生成成功:', newAsset.id)
    return NextResponse.json({ success: true, asset: { shotId: targetShot.shotId, assetId: newAsset.id, url } })
  } catch (e: any) {
    console.error('[STORYBOARD-REGENERATE] 重新生成失败:', e?.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
