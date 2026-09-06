export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

// 最小内容长度阈值
const MIN_CONTENT_LENGTH = 100

// 支持的文件类型
const SUPPORTED_TYPES = [
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
]

async function parseTxt(buffer: Buffer): Promise<string> {
  return buffer.toString('utf-8')
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  return result.text || ''
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'VALID_001', message: '请上传文件' }, { status: 400 })
    }

    if (!SUPPORTED_TYPES.includes(file.type)) {
      return NextResponse.json({
        error: 'VALID_002',
        message: '不支持的文件格式，请上传 txt、docx 或 pdf 文件'
      }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let content = ''

    if (file.type === 'text/plain') {
      content = await parseTxt(buffer)
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      content = await parseDocx(buffer)
    } else if (file.type === 'application/pdf') {
      content = await parsePdf(buffer)
    }

    // 清理内容
    content = content.trim()

    // 检查内容长度
    if (content.length < MIN_CONTENT_LENGTH) {
      return NextResponse.json({
        error: 'CONTENT_TOO_SHORT',
        message: `文件内容过短（${content.length} 字），至少需要 ${MIN_CONTENT_LENGTH} 字`,
        contentLength: content.length,
        minLength: MIN_CONTENT_LENGTH,
      }, { status: 400 })
    }

    // 将内容存入 rawIdea
    await prisma.project.update({
      where: { id: params.id },
      data: { rawIdea: content },
    })

    return NextResponse.json({
      success: true,
      contentLength: content.length,
      fileName: file.name,
    })
  } catch (e: any) {
    console.error('[UPLOAD-STORY] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
