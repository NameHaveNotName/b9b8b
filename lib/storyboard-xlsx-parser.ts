/**
 * Excel 分镜表解析器（含嵌入图片提取）
 *
 * 使用 exceljs 读取 xlsx 中的分镜数据和嵌入图片，
 * 通过列头关键词 + 数据模式双重检测识别 shotId 列和图片列，
 * 并将图片按所在行匹配到对应分镜。
 */

import ExcelJS from 'exceljs'

export interface StoryboardShot {
  shotId: string
  timecode?: string
  duration?: number
  narration?: string
  cameraMove?: string
  description: string
  visualDetail?: string
  transition?: string
}

export interface ExtractedImage {
  shotId: string
  imageIndex: number
  buffer: Buffer
  mimeType: string
  fileName: string
}

export interface ColumnDetection {
  method: 'keyword' | 'pattern' | 'both'
  shotIdCol: number | null
  imageCol: number | null
  shotIdCandidates: Array<{ col: number; label: string; confidence: number }>
  imageCandidates: Array<{ col: number; label: string; confidence: number }>
}

export interface ParseResult {
  type: 'storyboard'
  shots: StoryboardShot[]
  images: ExtractedImage[]
  columnDetection: ColumnDetection
  headerRow: number
  dataStartRow: number
  dataEndRow: number
  totalImages: number
  matchedImages: number
  needsShotIdSelection: boolean
  needsImageColSelection: boolean
}

const SHOT_ID_KEYWORDS = ['镜号', '镜头号', '编号', 'shot', 'shot_id', 'shot id', 'id', '序号', '镜头编号', '分镜号', '镜头序号', '分镜序号']
// 按优先级排序：越具体的关键词越靠前
const IMAGE_KEYWORDS = ['分镜图片', '分镜图', '参考图', '示意图', '截图', '缩略图', 'image', 'pic', '图片', '画面']

export async function parseXlsxWithImages(buffer: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as any)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    throw new Error('Excel 文件中没有工作表')
  }

  // 1. 检测表头行
  const headerRow = detectHeaderRow(worksheet)
  console.log(`[XLSX-PARSER] 表头行: ${headerRow}`)

  // 2. 检测 shotId 列（方法A：关键词，方法B：数据模式）
  const keywordShotId = detectShotIdByKeyword(worksheet, headerRow)
  const patternShotId = detectShotIdByPattern(worksheet, headerRow)

  let shotIdCol: number | null = null
  let shotIdMethod: ColumnDetection['method'] = 'keyword'
  let needsShotIdSelection = false

  if (keywordShotId.col === patternShotId.col && keywordShotId.col !== null) {
    // 两个方法结果相同，直接用
    shotIdCol = keywordShotId.col
    shotIdMethod = 'both'
  } else if (keywordShotId.col !== null && patternShotId.col !== null) {
    // 结果不同，需要用户选择
    needsShotIdSelection = true
  } else if (keywordShotId.col !== null) {
    shotIdCol = keywordShotId.col
    shotIdMethod = 'keyword'
  } else if (patternShotId.col !== null) {
    shotIdCol = patternShotId.col
    shotIdMethod = 'pattern'
  }

  // 3. 检测图片列（方法A：关键词，方法B：图片数量统计）
  const images = extractImages(worksheet)
  const keywordImageCol = detectImageColByKeyword(worksheet, headerRow)
  const patternImageCol = detectImageColByCount(images)

  let imageCol: number | null = null
  let imageMethod: ColumnDetection['method'] = 'keyword'
  let needsImageColSelection = false

  if (keywordImageCol.col === patternImageCol.col && keywordImageCol.col !== null) {
    imageCol = keywordImageCol.col
    imageMethod = 'both'
  } else if (keywordImageCol.col !== null && patternImageCol.col !== null) {
    needsImageColSelection = true
  } else if (keywordImageCol.col !== null) {
    imageCol = keywordImageCol.col
    imageMethod = 'keyword'
  } else if (patternImageCol.col !== null) {
    imageCol = patternImageCol.col
    imageMethod = 'pattern'
  }

  // 4. 确定数据范围
  const dataStartRow = headerRow + 1
  const dataEndRow = findDataEndRow(worksheet, dataStartRow, shotIdCol)

  console.log(`[XLSX-PARSER] 数据范围: ${dataStartRow}-${dataEndRow}, shotIdCol: ${shotIdCol}, imageCol: ${imageCol}`)

  // 5. 解析分镜数据
  const shots = parseShots(worksheet, dataStartRow, dataEndRow, shotIdCol, headerRow)

  // 6. 匹配图片到分镜
  const { matchedImages, matchedResults } = matchImagesToShots(images, shots, shotIdCol, worksheet, dataStartRow, dataEndRow)

  // 构建候选列信息（供前端展示）
  const shotIdCandidates = [
    keywordShotId.col !== null ? { col: keywordShotId.col, label: keywordShotId.label, confidence: 0.9 } : null,
    patternShotId.col !== null && patternShotId.col !== keywordShotId.col
      ? { col: patternShotId.col, label: patternShotId.label, confidence: 0.7 }
      : null,
  ].filter(Boolean) as Array<{ col: number; label: string; confidence: number }>

  const imageCandidates = [
    keywordImageCol.col !== null ? { col: keywordImageCol.col, label: keywordImageCol.label, confidence: 0.9 } : null,
    patternImageCol.col !== null && patternImageCol.col !== keywordImageCol.col
      ? { col: patternImageCol.col, label: patternImageCol.label, confidence: 0.7 }
      : null,
  ].filter(Boolean) as Array<{ col: number; label: string; confidence: number }>

  return {
    type: 'storyboard',
    shots,
    images: matchedResults,
    columnDetection: {
      method: shotIdMethod,
      shotIdCol,
      imageCol,
      shotIdCandidates,
      imageCandidates,
    },
    headerRow,
    dataStartRow,
    dataEndRow,
    totalImages: images.length,
    matchedImages,
    needsShotIdSelection,
    needsImageColSelection,
  }
}

// === 表头行检测 ===
function detectHeaderRow(worksheet: ExcelJS.Worksheet): number {
  const maxScan = Math.min(30, worksheet.rowCount)
  let bestRow = 3 // 默认第3行（参考文件结构）
  let bestScore = 0

  for (let r = 1; r <= maxScan; r++) {
    const row = worksheet.getRow(r)
    let score = 0
    row.eachCell((cell, colNumber) => {
      const val = String(cell.value || '').toLowerCase().trim()
      if (SHOT_ID_KEYWORDS.some(k => val.includes(k))) score += 3
      if (IMAGE_KEYWORDS.some(k => val.includes(k))) score += 2
      if (['时长', 'duration', '描述', 'description', '景别', '运镜', 'camera', '旁白', 'narration'].some(k => val.includes(k))) score += 1
    })
    if (score > bestScore) {
      bestScore = score
      bestRow = r
    }
  }

  // 如果没找到任何关键词，返回默认值3
  return bestScore > 0 ? bestRow : 3
}

// === 方法A：通过列头关键词检测 shotId 列 ===
function detectShotIdByKeyword(worksheet: ExcelJS.Worksheet, headerRow: number): { col: number | null; label: string } {
  for (const keyword of SHOT_ID_KEYWORDS) {
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const cell = worksheet.getCell(headerRow, c)
      const val = String(cell.value || '').toLowerCase().trim()
      if (val.includes(keyword)) {
        return { col: c, label: String(cell.value || '') }
      }
    }
  }
  return { col: null, label: '' }
}

// === 方法B：通过数据模式检测 shotId 列 ===
function detectShotIdByPattern(worksheet: ExcelJS.Worksheet, headerRow: number): { col: number | null; label: string } {
  const dataStart = headerRow + 1
  const maxCheck = Math.min(dataStart + 10, worksheet.rowCount)
  const maxCol = Math.min(10, worksheet.columnCount)

  const candidates: Array<{ col: number; score: number }> = []

  for (let c = 1; c <= maxCol; c++) {
    let score = 0
    for (let r = dataStart; r < maxCheck; r++) {
      const cell = worksheet.getCell(r, c)
      const val = String(cell.value || '').trim()
      // 数字编号格式：001, 002 或 1, 2, 3
      if (/^\d{1,4}$/.test(val)) {
        score++
      }
    }
    if (score >= 2) {
      candidates.push({ col: c, score })
    }
  }

  // 优先选左侧列
  candidates.sort((a, b) => a.col - b.col)
  const best = candidates[0]
  if (!best) return { col: null, label: '' }

  // 获取列头标签
  const headerCell = worksheet.getCell(headerRow, best.col)
  return { col: best.col, label: String(headerCell.value || `列${best.col}`) }
}

// === 方法A：通过列头关键词检测图片列 ===
function detectImageColByKeyword(worksheet: ExcelJS.Worksheet, headerRow: number): { col: number | null; label: string } {
  // 按关键词优先级遍历，先匹配到的更准确
  for (const keyword of IMAGE_KEYWORDS) {
    let found = false
    const row = worksheet.getRow(headerRow)
    row.eachCell((cell, colNumber) => {
      if (found) return
      const val = String(cell.value || '').toLowerCase().trim()
      if (val.includes(keyword)) {
        found = true
        return { col: colNumber, label: String(cell.value || '') }
      }
    })
    // eachCell 的 return 不会返回值，需要改用其他方式
  }

  // 备选方案：手动迭代
  for (const keyword of IMAGE_KEYWORDS) {
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const cell = worksheet.getCell(headerRow, c)
      const val = String(cell.value || '').toLowerCase().trim()
      if (val.includes(keyword)) {
        return { col: c, label: String(cell.value || '') }
      }
    }
  }

  return { col: null, label: '' }
}

// === 方法B：通过图片数量统计检测图片列 ===
function detectImageColByCount(images: Array<{ row: number; col: number }>): { col: number | null; label: string } {
  if (images.length === 0) return { col: null, label: '' }

  const colCounts = new Map<number, number>()
  for (const img of images) {
    colCounts.set(img.col, (colCounts.get(img.col) || 0) + 1)
  }

  let bestCol: number | null = null
  let bestCount = 0
  for (const [col, count] of colCounts) {
    if (count > bestCount) {
      bestCount = count
      bestCol = col
    }
  }

  return { col: bestCol, label: `列${bestCol}（${bestCount}张图片）` }
}

// === 提取嵌入图片 ===
function extractImages(worksheet: ExcelJS.Worksheet): Array<{ row: number; col: number; buffer: Buffer; mimeType: string; fileName: string }> {
  const results: Array<{ row: number; col: number; buffer: Buffer; mimeType: string; fileName: string }> = []

  // @ts-ignore - exceljs 的 getImages() 返回图片信息
  const imageMetas = worksheet.getImages() as Array<{
    imageId: number
    range: {
      tl: { nativeCol: number; nativeRow: number }
      br: { nativeCol: number; nativeRow: number }
    }
  }>

  for (const meta of imageMetas) {
    try {
      // exceljs 中 nativeRow/nativeCol 是 0-indexed，需要 +1 转为 Excel 行号
      const row = meta.range.tl.nativeRow + 1
      const col = meta.range.tl.nativeCol + 1

      // 通过 workbook.getImage 获取图片 buffer
      const imgResult = worksheet.workbook.getImage(meta.imageId) as any
      const imgBuffer: Buffer | null = imgResult?.buffer || imgResult
      if (!imgBuffer || imgBuffer.length === 0) continue

      // 检测 MIME 类型
      const { mimeType, ext } = detectImageMime(imgBuffer)

      results.push({
        row,
        col,
        buffer: imgBuffer,
        mimeType,
        fileName: `storyboard_${meta.imageId}.${ext}`,
      })
    } catch (e: any) {
      console.warn(`[XLSX-PARSER] 跳过图片 ${meta.imageId}:`, e?.message)
    }
  }

  return results
}

// === 图片 MIME 检测 ===
function detectImageMime(buffer: Buffer): { mimeType: string; ext: string } {
  if (buffer.length < 4) return { mimeType: 'image/png', ext: 'png' }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { mimeType: 'image/png', ext: 'png' }
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { mimeType: 'image/jpeg', ext: 'jpg' }
  }
  // GIF: 47 49 46
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { mimeType: 'image/gif', ext: 'gif' }
  }
  // BMP: 42 4D
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
    return { mimeType: 'image/bmp', ext: 'bmp' }
  }
  // WebP: 52 49 46 46
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return { mimeType: 'image/webp', ext: 'webp' }
  }

  return { mimeType: 'image/png', ext: 'png' }
}

// === 确定数据结束行 ===
function findDataEndRow(worksheet: ExcelJS.Worksheet, dataStartRow: number, shotIdCol: number | null): number {
  let lastDataRow = dataStartRow
  let emptyCount = 0
  const maxEmpty = 3 // 连续3个空行就停止

  for (let r = dataStartRow; r <= worksheet.rowCount; r++) {
    let hasContent = false
    const row = worksheet.getRow(r)

    if (shotIdCol) {
      const val = String(row.getCell(shotIdCol).value || '').trim()
      if (val && /^\d{1,4}$/.test(val)) {
        hasContent = true
      }
    } else {
      // 没有 shotId 列时，检查任意列是否有内容
      row.eachCell((cell) => {
        if (cell.value != null && String(cell.value).trim() !== '') {
          hasContent = true
        }
      })
    }

    if (hasContent) {
      lastDataRow = r
      emptyCount = 0
    } else {
      emptyCount++
      if (emptyCount >= maxEmpty) break
    }
  }

  return lastDataRow
}

// === 解析分镜数据 ===
function parseShots(
  worksheet: ExcelJS.Worksheet,
  dataStartRow: number,
  dataEndRow: number,
  shotIdCol: number | null,
  headerRow: number
): StoryboardShot[] {
  const shots: StoryboardShot[] = []

  // 如果没有识别到 shotId 列，自动标记镜号
  const autoNumber = shotIdCol === null

  // 识别其他列
  const colMap = detectOtherColumns(worksheet, headerRow)

  for (let r = dataStartRow; r <= dataEndRow; r++) {
    const row = worksheet.getRow(r)

    // 获取 shotId
    let shotId = ''
    if (shotIdCol) {
      shotId = String(row.getCell(shotIdCol).value || '').trim()
      // 跳过非数据行
      if (!shotId || shotId.length > 10 || shotId.includes('分镜') || shotId.includes('表') || shotId.includes('、')) {
        continue
      }
    } else {
      shotId = String(shots.length + 1).padStart(3, '0')
    }

    // 获取其他字段
    const description = colMap.description != null ? String(row.getCell(colMap.description).value || '').trim() : ''
    const cameraMove = colMap.cameraMove != null ? String(row.getCell(colMap.cameraMove).value || '').trim() : ''
    const narration = colMap.narration != null ? String(row.getCell(colMap.narration).value || '').trim() : ''
    const timecode = colMap.timecode != null ? String(row.getCell(colMap.timecode).value || '').trim() : ''
    const duration = colMap.duration != null ? parseTimecodeToSeconds(String(row.getCell(colMap.duration).value || '')) : 5
    const visualDetail = colMap.visualDetail != null ? String(row.getCell(colMap.visualDetail).value || '').trim() : ''
    const transition = colMap.transition != null ? String(row.getCell(colMap.transition).value || '').trim() : ''

    if (description || cameraMove || narration) {
      shots.push({
        shotId,
        timecode,
        duration,
        narration,
        cameraMove,
        description: description || cameraMove || narration,
        visualDetail,
        transition,
      })
    }
  }

  return shots
}

// === 检测其他列 ===
function detectOtherColumns(worksheet: ExcelJS.Worksheet, headerRow: number): Record<string, number | null> {
  const row = worksheet.getRow(headerRow)
  const colMap: Record<string, number | null> = {
    timecode: null,
    duration: null,
    narration: null,
    cameraMove: null,
    description: null,
    visualDetail: null,
    transition: null,
  }

  const keywordMap: Record<string, string[]> = {
    timecode: ['起止时间', '时间码', '时间', 'timecode', 'time'],
    duration: ['时长', 'duration', '秒'],
    narration: ['旁白', '台词', '台词/旁白', 'narration', 'dialogue', '对应音效'],
    cameraMove: ['运镜', '运镜描述', '镜头运动', 'camera', 'camera_move', 'movement', '景别', '景别／运镜', '景别/运镜', '机位/构图', '镜头运动'],
    description: ['画面描述', '描述', '画面', 'description', 'scene', '镜头画面描述', '镜头画面', '镜头画面（描述画面内容、角色动作、运动、光影、氛围、状态）'],
    visualDetail: ['视觉细节', '细节', '备注', 'visual', 'detail', 'note', 'AI镜头画面'],
    transition: ['剪辑点', '转场', 'transition', 'cut', '章节'],
  }

  row.eachCell((cell, colNumber) => {
    const val = String(cell.value || '').toLowerCase().trim()
    for (const [field, keywords] of Object.entries(keywordMap)) {
      if (colMap[field] == null && keywords.some(k => val.includes(k))) {
        colMap[field] = colNumber
      }
    }
  })

  return colMap
}

// === 时间码解析 ===
function parseTimecodeToSeconds(timecode: string): number {
  if (!timecode) return 5
  // 格式：0:00.000—0:04.200 或 0:00-0:05
  const match = timecode.match(/(\d+):(\d+(?:\.\d+)?)[^\d]*(\d+):(\d+(?:\.\d+)?)/)
  if (match) {
    const startMin = parseInt(match[1])
    const startSec = parseFloat(match[2])
    const endMin = parseInt(match[3])
    const endSec = parseFloat(match[4])
    return (endMin * 60 + endSec) - (startMin * 60 + startSec)
  }
  const num = parseFloat(timecode)
  return isNaN(num) ? 5 : num
}

// === 匹配图片到分镜 ===
function matchImagesToShots(
  images: Array<{ row: number; col: number; buffer: Buffer; mimeType: string; fileName: string }>,
  shots: StoryboardShot[],
  shotIdCol: number | null,
  worksheet: ExcelJS.Worksheet,
  dataStartRow: number,
  dataEndRow: number
): { matchedImages: number; matchedResults: ExtractedImage[] } {
  const results: ExtractedImage[] = []
  let matchedCount = 0

  // 构建 shotId -> 行号的映射（如果 shotIdCol 存在）
  const shotIdToRow = new Map<string, number>()
  if (shotIdCol) {
    for (let r = dataStartRow; r <= dataEndRow; r++) {
      const val = String(worksheet.getCell(r, shotIdCol).value || '').trim()
      if (val && /^\d{1,4}$/.test(val)) {
        shotIdToRow.set(val, r)
      }
    }
  }

  // 每个 shot 的图片计数
  const shotImageCount = new Map<string, number>()

  for (const img of images) {
    let matchedShotId: string | null = null

    if (shotIdCol) {
      // 方法1：直接读图片所在行的 shotId 列
      const cellVal = String(worksheet.getCell(img.row, shotIdCol).value || '').trim()
      if (cellVal && /^\d{1,4}$/.test(cellVal)) {
        matchedShotId = cellVal
      }

      // 方法2：向上查找最近的有效 shotId（最多向上5行）
      if (!matchedShotId) {
        for (let up = 1; up <= 5; up++) {
          const checkRow = img.row - up
          if (checkRow < dataStartRow) break
          const upVal = String(worksheet.getCell(checkRow, shotIdCol).value || '').trim()
          if (upVal && /^\d{1,4}$/.test(upVal)) {
            matchedShotId = upVal
            break
          }
        }
      }
    } else {
      // 没有 shotId 列，按行号推算
      const shotIndex = img.row - dataStartRow
      if (shotIndex >= 0 && shotIndex < shots.length) {
        matchedShotId = shots[shotIndex].shotId
      }
    }

    if (!matchedShotId) continue

    // 确认这个 shotId 存在于 shots 中
    const shot = shots.find(s => s.shotId === matchedShotId)
    if (!shot) continue

    const count = shotImageCount.get(matchedShotId) || 0
    shotImageCount.set(matchedShotId, count + 1)

    results.push({
      shotId: matchedShotId,
      imageIndex: count,
      buffer: img.buffer,
      mimeType: img.mimeType,
      fileName: img.fileName,
    })
    matchedCount++
  }

  return { matchedImages: matchedCount, matchedResults: results }
}
