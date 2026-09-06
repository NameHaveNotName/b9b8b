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
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

// Excel 分镜表的列映射
const STORYBOARD_COLUMN_MAP = {
  shotId: ['镜号', '镜头号', '编号', 'shot', 'shot_id', 'id'],
  timecode: ['时间码', '时间', 'timecode', 'time'],
  duration: ['时长', 'duration', '秒'],
  narration: ['旁白', '台词', '台词/旁白', 'narration', 'dialogue'],
  cameraMove: ['运镜', '运镜描述', '镜头运动', 'camera', 'camera_move', 'movement'],
  description: ['画面描述', '描述', '画面', 'description', 'scene'],
  visualDetail: ['视觉细节', '细节', '备注', 'visual', 'detail', 'note'],
  transition: ['剪辑点', '转场', 'transition', 'cut'],
}

interface StoryboardShot {
  shotId: string
  timecode?: string
  duration?: number
  narration?: string
  cameraMove?: string
  description: string
  visualDetail?: string
  transition?: string
}

function detectStoryboardColumns(headers: string[]): Record<string, number> | null {
  const mapping: Record<string, number> = {}
  let matchCount = 0

  for (const [field, aliases] of Object.entries(STORYBOARD_COLUMN_MAP)) {
    for (let i = 0; i < headers.length; i++) {
      const header = (headers[i] || '').toLowerCase().trim()
      if (aliases.some(alias => header.includes(alias.toLowerCase()))) {
        mapping[field] = i
        matchCount++
        break
      }
    }
  }

  // 至少匹配3个字段才认为是分镜表
  return matchCount >= 3 ? mapping : null
}

function parseTimecodeToSeconds(timecode: string): number {
  if (!timecode) return 5
  // 格式：0:00.00-0:05.00 或 0:00-0:05
  const match = timecode.match(/(\d+):(\d+(?:\.\d+)?)-(\d+):(\d+(?:\.\d+)?)/)
  if (match) {
    const startMin = parseInt(match[1])
    const startSec = parseFloat(match[2])
    const endMin = parseInt(match[3])
    const endSec = parseFloat(match[4])
    return (endMin * 60 + endSec) - (startMin * 60 + startSec)
  }
  // 格式：5 或 5.5
  const num = parseFloat(timecode)
  return isNaN(num) ? 5 : num
}

async function parseXlsx(buffer: Buffer): Promise<{ type: 'storyboard' | 'text', content: string, shots?: StoryboardShot[] }> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]

  if (data.length < 2) {
    throw new Error('Excel 文件内容为空或格式不正确')
  }

  // 查找表头行（第一行非空行）
  let headerRowIndex = 0
  for (let i = 0; i < Math.min(5, data.length); i++) {
    if (data[i] && data[i].length >= 3) {
      headerRowIndex = i
      break
    }
  }

  const headers = (data[headerRowIndex] || []).map((h: any) => String(h || '').trim())
  const columnMap = detectStoryboardColumns(headers)

  if (columnMap) {
    // 检测到分镜表格式
    const shots: StoryboardShot[] = []
    for (let i = headerRowIndex + 1; i < data.length; i++) {
      const row = data[i]
      if (!row || row.length < 3) continue

      const shotId = columnMap.shotId !== undefined ? String(row[columnMap.shotId] || '').trim() : ''
      if (!shotId) continue

      const timecode = columnMap.timecode !== undefined ? String(row[columnMap.timecode] || '').trim() : ''
      const duration = columnMap.duration !== undefined ? parseTimecodeToSeconds(String(row[columnMap.duration] || '')) : 5
      const narration = columnMap.narration !== undefined ? String(row[columnMap.narration] || '').trim() : ''
      const cameraMove = columnMap.cameraMove !== undefined ? String(row[columnMap.cameraMove] || '').trim() : ''
      const description = columnMap.description !== undefined ? String(row[columnMap.description] || '').trim() : ''
      const visualDetail = columnMap.visualDetail !== undefined ? String(row[columnMap.visualDetail] || '').trim() : ''
      const transition = columnMap.transition !== undefined ? String(row[columnMap.transition] || '').trim() : ''

      if (description || cameraMove) {
        shots.push({
          shotId,
          timecode,
          duration,
          narration,
          cameraMove,
          description,
          visualDetail,
          transition,
        })
      }
    }

    if (shots.length > 0) {
      // 将分镜表转换为文本格式
      const textContent = shots.map(s =>
        `镜头${s.shotId}：${s.description}${s.cameraMove ? `（运镜：${s.cameraMove}）` : ''}${s.narration ? `【旁白：${s.narration}】` : ''}`
      ).join('\n')

      return { type: 'storyboard', content: textContent, shots }
    }
  }

  // 未检测到分镜表格式，作为普通文本处理
  const textContent = data
    .filter(row => row && row.length > 0)
    .map(row => row.filter((cell: any) => cell != null).join(' | '))
    .join('\n')

  return { type: 'text', content: textContent }
}

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
        message: '不支持的文件格式，请上传 txt、docx、pdf 或 xlsx 文件'
      }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let content = ''
    let contentType: 'story' | 'storyboard' = 'story'
    let storyboardShots: StoryboardShot[] | undefined

    if (file.type === 'text/plain') {
      content = await parseTxt(buffer)
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      content = await parseDocx(buffer)
    } else if (file.type === 'application/pdf') {
      content = await parsePdf(buffer)
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const result = await parseXlsx(buffer)
      content = result.content
      contentType = result.type === 'storyboard' ? 'storyboard' : 'story'
      storyboardShots = result.shots
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
      contentType,
      storyboardShots,
    })
  } catch (e: any) {
    console.error('[UPLOAD-STORY] Error:', e.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
