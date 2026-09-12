export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { parseXlsxWithImages } from '@/lib/storyboard-xlsx-parser'

export async function POST(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'VALID_001', message: '请上传文件' }, { status: 400 })
    }

    if (!file.name.endsWith('.xlsx')) {
      return NextResponse.json({ error: 'VALID_002', message: '请上传 .xlsx 格式的 Excel 文件' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await parseXlsxWithImages(buffer)

    // 将图片 buffer 转为 base64 供前端预览
    const imagePreviews: Record<string, Array<{ base64: string; mimeType: string; imageIndex: number }>> = {}
    for (const img of result.images) {
      if (!imagePreviews[img.shotId]) {
        imagePreviews[img.shotId] = []
      }
      imagePreviews[img.shotId].push({
        base64: img.buffer.toString('base64'),
        mimeType: img.mimeType,
        imageIndex: img.imageIndex,
      })
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      shots: result.shots,
      imagePreviews,
      columnDetection: result.columnDetection,
      headerRow: result.headerRow,
      dataStartRow: result.dataStartRow,
      dataEndRow: result.dataEndRow,
      totalImages: result.totalImages,
      matchedImages: result.matchedImages,
      needsShotIdSelection: result.needsShotIdSelection,
      needsImageColSelection: result.needsImageColSelection,
    })
  } catch (e: any) {
    console.error('[PARSE-STORYBOARD-FILE] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
