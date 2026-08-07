'use client'

type ExportShot = {
  shotId?: string
  actNumber?: number | string | null
  sceneName?: string
  description?: string
  cameraMove?: string
  duration?: number | string
  characters?: string[]
  keyAction?: string
  tourismFunction?: string
  referenceImageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
}

type ExportVoiceoverSegment = {
  shotId?: string
  text?: string
  speaker?: string
  sequence?: number
}

type ExportProgress = {
  phase: 'prepare' | 'cache' | 'workbook' | 'download' | 'done'
  completed: number
  total: number
  reused: number
  fetched: number
  message: string
}

type StoryboardExcelOptions = {
  projectName: string
  rawIdea?: string
  framework?: any
  shots: ExportShot[]
  voiceovers?: ExportVoiceoverSegment[]
  characterMap?: Record<string, string>
  mode?: 'reference' | 'keyframe' | string
  exportKey?: string
  onProgress?: (progress: ExportProgress) => void
}

type CachedImage = {
  key: string
  url: string
  buffer: ArrayBuffer
  extension: 'png' | 'jpeg' | 'gif'
  width?: number
  height?: number
  updatedAt: number
}

type ExportManifest = {
  exportKey: string
  imageKeys: string[]
  failedUrls: Record<string, string>
  updatedAt: number
}

const DB_NAME = 'ai-film-flow-export-cache'
const DB_VERSION = 1
const IMAGE_STORE = 'images'
const MANIFEST_PREFIX = 'storyboard-excel-export:'

function safeFilename(name: string) {
  return String(name || 'project').replace(/[\\/:*?"<>|]/g, '_')
}

function actNumberOf(shot: ExportShot) {
  const n = Number(shot.actNumber)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function characterNames(ids: string[] | undefined, characterMap: Record<string, string>) {
  return (ids || []).map((id) => characterMap[id] || id).join('、')
}

function normalizeCharacterRole(character: any) {
  const name = String(character?.name || character?.id || '').trim()
  const raw = [
    character?.role,
    character?.description,
    character?.visualDescription,
  ].filter(Boolean).join('；')
  if (/海贝/.test(name)) return ['小女孩', raw].filter(Boolean).join('；')
  if (/海乐/.test(name)) return ['白色吉祥物', raw].filter(Boolean).join('；')
  return raw
}

function stripDurationSeconds(value: number | string | undefined) {
  if (value === undefined || value === null || value === '') return ''
  const text = String(value).trim()
  const match = text.match(/[\d.]+/)
  return match ? Number(match[0]) : ''
}

function durationNumber(value: number | string | undefined) {
  const parsed = stripDurationSeconds(value)
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

function formatDuration(value: number | string | undefined) {
  const parsed = stripDurationSeconds(value)
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : ''
}

function shotNumber(index: number) {
  return String(index + 1).padStart(3, '0')
}

function chapterTitle(shot: ExportShot, index: number) {
  const scene = String(shot.sceneName || '').trim()
  if (scene && !/^场景名称$/.test(scene)) return scene
  return `${String(actNumberOf(shot)).padStart(2, '0')}｜第 ${actNumberOf(shot)} 幕`
}

function normalizeVoiceoverShotId(value: string | undefined) {
  return String(value || '').replace(/^act\d+_/, '')
}

function sanitizeVoiceoverText(value: unknown) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (/^[\d\s.,，。:：;；\-_/\\]+$/.test(text)) return ''
  return text
}

function voiceoverTextFor(shot: ExportShot, voiceovers: ExportVoiceoverSegment[], index: number) {
  const act = actNumberOf(shot)
  const sid = String(shot.shotId || '')
  const uniqueId = `act${act}_${sid}`
  const exactTexts = voiceovers
    .filter((item) => item.shotId === uniqueId)
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
    .map((item) => sanitizeVoiceoverText(item.text))
    .filter(Boolean)
  if (exactTexts.length > 0) return exactTexts.join('\n')

  const bySequence = voiceovers.find((item) => item.sequence === index + 1)
  const sequenceText = sanitizeVoiceoverText(bySequence?.text)
  if (sequenceText) return sequenceText

  const sameShotIdCount = voiceovers.filter((item) => normalizeVoiceoverShotId(item.shotId) === sid).length
  if (sameShotIdCount > 0) {
    const looseTexts = voiceovers
      .filter((item) => normalizeVoiceoverShotId(item.shotId) === sid)
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
      .map((item) => sanitizeVoiceoverText(item.text))
      .filter(Boolean)
    return looseTexts.join('\n')
  }
  return ''
}

function frameworkFromOptions(options: StoryboardExcelOptions) {
  return options.framework || {}
}

function characterRows(framework: any) {
  const characters = Array.isArray(framework?.characters) ? framework.characters : []
  return characters.map((character: any) => [
    character.name || character.id || '角色',
    normalizeCharacterRole(character),
  ])
}

function imageExtension(contentType: string, url: string): 'png' | 'jpeg' | 'gif' {
  if (/jpe?g/i.test(contentType) || /\.jpe?g(\?|$)/i.test(url)) return 'jpeg'
  if (/gif/i.test(contentType) || /\.gif(\?|$)/i.test(url)) return 'gif'
  return 'png'
}

function hashText(input: string) {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function makeExportKey(options: StoryboardExcelOptions) {
  if (options.exportKey) return options.exportKey
  const payload = JSON.stringify({
    projectName: options.projectName,
    mode: options.mode || 'keyframe',
    shots: options.shots.map((shot) => ({
      id: shot.shotId,
      act: actNumberOf(shot),
      first: shot.firstFrameUrl || shot.referenceImageUrl || '',
      last: shot.lastFrameUrl || '',
    })),
  })
  return `storyboard:${hashText(payload)}`
}

function manifestKey(exportKey: string) {
  return `${MANIFEST_PREFIX}${exportKey}`
}

function readManifest(exportKey: string): ExportManifest {
  if (typeof window === 'undefined') {
    return { exportKey, imageKeys: [], failedUrls: {}, updatedAt: Date.now() }
  }
  try {
    const raw = window.localStorage.getItem(manifestKey(exportKey))
    if (!raw) return { exportKey, imageKeys: [], failedUrls: {}, updatedAt: Date.now() }
    const parsed = JSON.parse(raw) as ExportManifest
    return {
      exportKey,
      imageKeys: Array.isArray(parsed.imageKeys) ? parsed.imageKeys : [],
      failedUrls: parsed.failedUrls && typeof parsed.failedUrls === 'object' ? parsed.failedUrls : {},
      updatedAt: parsed.updatedAt || Date.now(),
    }
  } catch {
    return { exportKey, imageKeys: [], failedUrls: {}, updatedAt: Date.now() }
  }
}

function writeManifest(manifest: ExportManifest) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(manifestKey(manifest.exportKey), JSON.stringify({
    ...manifest,
    imageKeys: Array.from(new Set(manifest.imageKeys)),
    updatedAt: Date.now(),
  }))
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getCachedImage(db: IDBDatabase, key: string): Promise<CachedImage | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readonly')
    const request = tx.objectStore(IMAGE_STORE).get(key)
    request.onsuccess = () => resolve((request.result as CachedImage | undefined) || null)
    request.onerror = () => reject(request.error)
  })
}

async function putCachedImage(db: IDBDatabase, image: CachedImage): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, 'readwrite')
    tx.objectStore(IMAGE_STORE).put(image)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function fetchImage(url: string) {
  if (!url || !/^https?:\/\//i.test(url)) return null
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') || ''
  const buffer = await response.arrayBuffer()
  const dimensions = await measureImageBuffer(buffer, contentType)
  return { buffer, extension: imageExtension(contentType, url), ...dimensions }
}

async function measureImageBuffer(buffer: ArrayBuffer, contentType = 'image/png'): Promise<{ width?: number; height?: number }> {
  if (typeof window === 'undefined') return {}
  const blob = new Blob([buffer], { type: contentType || 'image/png' })
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(blob)
      const dimensions = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return dimensions
    } catch {
      // Fall through to HTMLImageElement fallback.
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const dimensions = { width: img.naturalWidth, height: img.naturalHeight }
      URL.revokeObjectURL(url)
      resolve(dimensions)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({})
    }
    img.src = url
  })
}

async function ensureImageDimensions(db: IDBDatabase, image: CachedImage): Promise<CachedImage> {
  if (image.width && image.height) return image
  const dimensions = await measureImageBuffer(image.buffer)
  if (!dimensions.width || !dimensions.height) return image
  const next = { ...image, ...dimensions, updatedAt: Date.now() }
  await putCachedImage(db, next).catch(() => undefined)
  return next
}

function fitImageSize(image: CachedImage, maxWidth: number) {
  const naturalWidth = image.width && image.width > 0 ? image.width : maxWidth
  const naturalHeight = image.height && image.height > 0 ? image.height : Math.round(maxWidth * 9 / 16)
  const width = Math.min(maxWidth, naturalWidth)
  const height = Math.round(width * naturalHeight / naturalWidth)
  return { width, height }
}

function pixelsToExcelRowHeight(px: number) {
  return Math.ceil(px * 0.75)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function emitProgress(
  options: StoryboardExcelOptions,
  progress: Omit<ExportProgress, 'message'> & { message?: string },
) {
  options.onProgress?.({
    ...progress,
    message: progress.message || '',
  })
}

export async function exportStoryboardExcel(options: StoryboardExcelOptions) {
  const ExcelJS = await import('exceljs')
  const exportKey = makeExportKey(options)
  const manifest = readManifest(exportKey)
  const cachedByUrl = new Map<string, CachedImage>()
  const failedUrls = new Map<string, string>(Object.entries(manifest.failedUrls || {}))
  const db = await openCacheDb()
  let reused = 0
  let fetched = 0

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AI Film Flow'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet('正式分镜表', {
    views: [{ state: 'frozen', ySplit: 16 }],
  })

  const framework = frameworkFromOptions(options)
  const totalDuration = options.shots.reduce((sum, shot) => sum + durationNumber(shot.duration), 0)
  const chapters = Array.from(new Set(options.shots.map((shot, index) => chapterTitle(shot, index))))

  worksheet.columns = [
    { header: '镜号', key: 'shotNo', width: 14 },
    { header: '章节（纵向合并）', key: 'chapter', width: 22 },
    { header: '时长', key: 'duration', width: 10 },
    { header: '景别／运镜', key: 'cameraMove', width: 22 },
    { header: '镜头画面描述', key: 'description', width: 58 },
    { header: '镜头画面图片', key: 'firstImage', width: 28 },
    { header: '旁白（纵向合并）', key: 'voiceover', width: 56 },
  ]

  const rows = options.shots.map((shot, index) => {
    const firstImageUrl =
      options.mode === 'reference'
        ? shot.referenceImageUrl || shot.firstFrameUrl || ''
        : shot.firstFrameUrl || shot.referenceImageUrl || ''
    return {
      shot,
      rowNumber: index + 17,
      actNumber: actNumberOf(shot),
      chapter: chapterTitle(shot, index),
      firstImageUrl,
      lastImageUrl: shot.lastFrameUrl || '',
      voiceover: voiceoverTextFor(shot, options.voiceovers || [], index),
    }
  })

  const uniqueImageUrls = Array.from(new Set(
    rows.flatMap((item) => [item.firstImageUrl]).filter(Boolean),
  ))
  const totalImages = uniqueImageUrls.length

  emitProgress(options, {
    phase: 'prepare',
    completed: 0,
    total: totalImages,
    reused,
    fetched,
    message: totalImages ? '正在检查本地导出缓存...' : '没有需要嵌入的图片。',
  })

  for (let index = 0; index < uniqueImageUrls.length; index += 1) {
    const imageUrl = uniqueImageUrls[index]
    const imageKey = hashText(imageUrl)
    const cached = await getCachedImage(db, imageKey)
    if (cached) {
      cachedByUrl.set(imageUrl, cached)
      reused += 1
      if (!manifest.imageKeys.includes(imageKey)) {
        manifest.imageKeys.push(imageKey)
        writeManifest(manifest)
      }
      emitProgress(options, {
        phase: 'cache',
        completed: index + 1,
        total: totalImages,
        reused,
        fetched,
        message: `复用已缓存图片 ${index + 1}/${totalImages}`,
      })
      continue
    }

    try {
      const image = await fetchImage(imageUrl)
      if (!image) throw new Error('empty image url')
      const cachedImage: CachedImage = {
        key: imageKey,
        url: imageUrl,
        buffer: image.buffer,
        extension: image.extension,
        width: image.width,
        height: image.height,
        updatedAt: Date.now(),
      }
      await putCachedImage(db, cachedImage)
      cachedByUrl.set(imageUrl, cachedImage)
      manifest.imageKeys.push(imageKey)
      delete manifest.failedUrls[imageUrl]
      fetched += 1
    } catch (err: any) {
      failedUrls.set(imageUrl, err?.message || '图片下载失败')
      manifest.failedUrls[imageUrl] = err?.message || '图片下载失败'
    }
    writeManifest(manifest)
    emitProgress(options, {
      phase: 'cache',
      completed: index + 1,
      total: totalImages,
      reused,
      fetched,
      message: `已处理图片 ${index + 1}/${totalImages}`,
    })
  }

  const titleColor = 'FF173A5E'
  const sectionColor = 'FFE9EEF6'
  const headerColor = 'FF243B53'

  worksheet.mergeCells('A1:G2')
  worksheet.getCell('A1').value = options.projectName
  worksheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } }
  worksheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: titleColor } }
  worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' }
  worksheet.getRow(1).height = 34
  worksheet.getRow(2).height = 34

  worksheet.mergeCells('A3:G3')
  worksheet.getCell('A3').value = `${options.projectName} · 正式分镜表`
  worksheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' }
  worksheet.getCell('A3').font = { bold: true, color: { argb: 'FF334155' } }

  worksheet.addRow([])
  worksheet.addRow(['镜头总数', options.shots.length, '预计总时长', Number(totalDuration.toFixed(1)), '章节数', chapters.length, '以短镜头和章节旁白为主'])
  worksheet.getRow(5).alignment = { vertical: 'middle', horizontal: 'center' }

  worksheet.mergeCells('A6:G6')
  worksheet.getCell('A6').value = '一、项目基本信息'
  worksheet.getCell('A6').font = { bold: true, color: { argb: 'FFFFFFFF' } }
  worksheet.getCell('A6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } }

  worksheet.addRow(['片名', options.projectName, '', '目标时长', framework?.totalDuration || '', '画幅', '16:9｜1920×1080'])
  worksheet.addRow(['内容定位', framework?.inspiration || framework?.synopsis || options.rawIdea || '', '', '', '', '', ''])
  worksheet.mergeCells('B8:G8')
  worksheet.addRow(['整体风格', framework?.styleGuide || '真实、克制、有温度；真实素材负责识别，正式文字全部后期制作。', '', '', '', '', ''])
  worksheet.mergeCells('B9:G9')
  worksheet.addRow(['素材与字幕', '优先使用官方或客户审核素材；正式名称、标识、章程、校训、日期、关键词和字幕全部后期规范叠加，AI 画面只作镜位与构图参考。', '', '', '', '', ''])
  worksheet.mergeCells('B10:G10')

  worksheet.mergeCells('A11:G11')
  worksheet.getCell('A11').value = '二、人物设定'
  worksheet.getCell('A11').font = { bold: true, color: { argb: 'FFFFFFFF' } }
  worksheet.getCell('A11').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } }

  const people = characterRows(framework)
  const personRows = people.length > 0 ? people.slice(0, 3) : [['角色设定', '当前项目未提供明确角色设定；建议在框架中锁定主要人物身份、外观、服装和叙事职责。']]
  for (let i = 0; i < 3; i += 1) {
    const item = personRows[i] || ['', '']
    worksheet.addRow([item[0], item[1], '', '', '', '', ''])
    worksheet.mergeCells(12 + i, 2, 12 + i, 7)
  }
  worksheet.addRow(['一致性要求', '全片锁定主要人物的脸型、年龄、发型与服装；特殊场景只增加必要道具或防护装备。人物长口型镜头从严控制。', '', '', '', '', ''])
  worksheet.mergeCells('B15:G15')

  const headerRow = worksheet.addRow(['镜号', '章节（纵向合并）', '时长', '景别／运镜', '镜头画面描述', '镜头画面图片', '旁白（纵向合并）'])
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.height = 25
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: titleColor } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })

  for (const item of rows) {
    const descriptionParts = [
      item.shot.description || '',
      item.shot.keyAction ? `核心动作：${item.shot.keyAction}` : '',
      item.shot.tourismFunction ? `镜头功能：${item.shot.tourismFunction}` : '',
      item.shot.characters?.length ? `出场：${characterNames(item.shot.characters, options.characterMap || {})}` : '',
    ].filter(Boolean)
    const row = worksheet.addRow({
      shotNo: shotNumber(item.rowNumber - 17),
      chapter: item.chapter,
      duration: formatDuration(item.shot.duration),
      cameraMove: item.shot.cameraMove || '',
      description: descriptionParts.join('\n'),
      firstImage: item.firstImageUrl ? '图片加载中' : '',
      voiceover: item.voiceover,
    })
    row.height = 92
    row.alignment = { vertical: 'middle', wrapText: true }
  }

  emitProgress(options, {
    phase: 'workbook',
    completed: totalImages,
    total: totalImages,
    reused,
    fetched,
    message: '正在组装 Excel 文件...',
  })

  for (const [col, maxWidth] of [[6, 170]] as const) {
    for (const item of rows) {
      const imageUrl = item.firstImageUrl
      const cell = worksheet.getCell(item.rowNumber, col)
      if (!imageUrl) {
        cell.value = ''
        continue
      }
      const image = cachedByUrl.get(imageUrl)
      if (image) {
        const imageWithDimensions = await ensureImageDimensions(db, image)
        cachedByUrl.set(imageUrl, imageWithDimensions)
        const displaySize = fitImageSize(imageWithDimensions, maxWidth)
        const row = worksheet.getRow(item.rowNumber)
        row.height = Math.max(row.height || 0, pixelsToExcelRowHeight(displaySize.height + 14))
        const imageId = workbook.addImage({
          buffer: imageWithDimensions.buffer,
          extension: imageWithDimensions.extension,
        })
        cell.value = ''
        worksheet.addImage(imageId, {
          tl: { col: col - 1 + 0.08, row: item.rowNumber - 1 + 0.08 },
          ext: { width: displaySize.width, height: displaySize.height },
        })
      } else {
        cell.value = { text: '图片链接', hyperlink: imageUrl }
        cell.font = { color: { argb: 'FF2563EB' }, underline: true }
      }
    }
  }

  let mergeStart = 17
  for (let i = 0; i <= rows.length; i += 1) {
    const current = rows[i]?.chapter
    const previous = rows[i - 1]?.chapter
    if (i === 0) continue
    if (current !== previous) {
      const mergeEnd = 17 + i
      if (mergeEnd - mergeStart > 1) {
        worksheet.mergeCells(mergeStart, 2, mergeEnd - 1, 2)
        const chapterCell = worksheet.getCell(mergeStart, 2)
        chapterCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
        const chapterVoiceovers = rows
          .slice(mergeStart - 17, mergeEnd - 17)
          .map((item) => item.voiceover)
          .filter(Boolean)
        if (chapterVoiceovers.length > 0) {
          worksheet.getCell(mergeStart, 7).value = Array.from(new Set(chapterVoiceovers)).join('\n')
          worksheet.mergeCells(mergeStart, 7, mergeEnd - 1, 7)
          worksheet.getCell(mergeStart, 7).alignment = { vertical: 'middle', wrapText: true }
        }
      }
      mergeStart = mergeEnd
    }
  }

  const noteRow = worksheet.addRow([])
  const noteRowNumber = noteRow.number + 1
  worksheet.addRow([
    `事实核验与后期提示：正式校名、校徽、章程名、校训、校歌、日期、政策条款、票务/开放时间等必须以官方资料或客户审核材料为准；AI 生成画面中的文字仅作构图参考，不作为最终文字使用。`,
    '',
    '',
    '',
    '',
    '',
    '',
  ])
  worksheet.mergeCells(noteRowNumber, 1, noteRowNumber, 7)
  worksheet.getCell(noteRowNumber, 1).font = { italic: true, color: { argb: 'FF64748B' } }
  worksheet.getCell(noteRowNumber, 1).alignment = { vertical: 'middle', wrapText: true }
  worksheet.getRow(noteRowNumber).height = 28

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE7E5E4' } },
        left: { style: 'thin', color: { argb: 'FFE7E5E4' } },
        bottom: { style: 'thin', color: { argb: 'FFE7E5E4' } },
        right: { style: 'thin', color: { argb: 'FFE7E5E4' } },
      }
      cell.alignment = {
        vertical: cell.alignment?.vertical || 'middle',
        horizontal: cell.alignment?.horizontal,
        wrapText: true,
      }
    })
  })

  emitProgress(options, {
    phase: 'download',
    completed: totalImages,
    total: totalImages,
    reused,
    fetched,
    message: '正在写出 Excel 文件...',
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, `${safeFilename(options.projectName)}_分镜解读_${new Date().toISOString().slice(0, 10)}.xlsx`)

  emitProgress(options, {
    phase: 'done',
    completed: totalImages,
    total: totalImages,
    reused,
    fetched,
    message: failedUrls.size > 0
      ? `导出完成，${failedUrls.size} 张图片下载失败，已保留链接。`
      : '导出完成。',
  })
}

// ============================================================
// 分镜表导入解析（支持 Excel 和 JSON）
// ============================================================

export type ImportedShot = {
  shotId: string
  actNumber: number
  sceneName: string
  description: string
  cameraMove: string
  duration: number
  characters: string[]
  keyAction: string
  referenceImageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
}

function generateShotId(index: number): string {
  return `shot_${String(index + 1).padStart(3, '0')}`
}

function parseCameraMove(value: string | undefined): string {
  if (!value) return '固定'
  const normalized = value.trim()
  const CAMERA_MOVES = ['推镜头', '拉镜头', '摇镜头', '移镜头', '跟镜头', '升镜头', '降镜头', '固定']
  const matched = CAMERA_MOVES.find(m => normalized.includes(m.replace('镜头', '')))
  return matched || '固定'
}

function parseDuration(value: string | number | undefined): number {
  if (!value) return 5
  const num = typeof value === 'string' ? parseFloat(value) : value
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 5
}

function parseActNumber(value: string | number | undefined): number {
  if (!value) return 1
  const num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9]/g, '')) : value
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 1
}

function extractImageUrlFromCell(cellValue: unknown): string | undefined {
  if (!cellValue) return undefined
  if (typeof cellValue === 'string' && cellValue.startsWith('http')) return cellValue
  if (typeof cellValue === 'object' && cellValue !== null) {
    const obj = cellValue as Record<string, unknown>
    if (obj.hyperlink && typeof obj.hyperlink === 'string') return obj.hyperlink
    if (obj.text && typeof obj.text === 'string' && obj.text.startsWith('http')) return obj.text
  }
  return undefined
}

export async function parseStoryboardExcel(buffer: ArrayBuffer): Promise<ImportedShot[]> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const worksheet = workbook.getWorksheet('正式分镜表')
  if (!worksheet) {
    throw new Error('Excel 文件中未找到"正式分镜表"工作表')
  }

  const shots: ImportedShot[] = []
  const rowStart = 17

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < rowStart) return

    const rowIndex = rowNumber - rowStart
    const cells = row.values as (unknown | undefined)[]
    if (!cells || cells.length === 0) return

    const shotNoCell = cells[1]
    const durationCell = cells[3]
    const cameraMoveCell = cells[4]
    const descriptionCell = cells[5]
    const imageCell = cells[6]

    const description = typeof descriptionCell === 'string' ? descriptionCell.trim() : ''
    if (!description) return

    const actNumber = parseActNumber(shotNoCell as string | number | undefined)
    const cameraMove = parseCameraMove(cameraMoveCell as string | undefined)
    const duration = parseDuration(durationCell as string | number | undefined)
    const imageUrl = extractImageUrlFromCell(imageCell)

    shots.push({
      shotId: generateShotId(rowIndex),
      actNumber,
      sceneName: '',
      description,
      cameraMove,
      duration,
      characters: [],
      keyAction: '',
      referenceImageUrl: imageUrl,
      firstFrameUrl: imageUrl,
    })
  })

  return shots
}

export function parseStoryboardJson(data: unknown): ImportedShot[] {
  if (!data || typeof data !== 'object') {
    throw new Error('JSON 数据格式无效')
  }

  const obj = data as Record<string, unknown>

  let shotsArray: unknown[] = []
  if (Array.isArray(obj.shots)) {
    shotsArray = obj.shots
  } else if (Array.isArray(obj)) {
    shotsArray = obj
  } else {
    throw new Error('JSON 数据中未找到 shots 数组')
  }

  return shotsArray.map((item, index) => {
    if (!item || typeof item !== 'object') {
      return null as unknown as ImportedShot
    }
    const shot = item as Record<string, unknown>

    const description = String(shot.镜头描述 || shot.description || shot.desc || shot.描述 || '')
    if (!description) return null as unknown as ImportedShot

    return {
      shotId: String(shot.shotId || shot.镜头序号 || shot.shot_id || generateShotId(index)),
      actNumber: parseActNumber((shot.actNumber || shot.幕号 || shot.act_number || 1) as string | number),
      sceneName: String(shot.sceneName || shot.场景名称 || shot.scene || ''),
      description,
      cameraMove: parseCameraMove((shot.cameraMove || shot.运镜方式 || shot.camera_move || '') as string),
      duration: parseDuration((shot.duration || shot.时长 || 5) as string | number),
      characters: Array.isArray(shot.characters || shot.角色) ? (shot.characters || shot.角色) as string[] : [],
      keyAction: String(shot.keyAction || shot.核心动作 || shot.key_action || ''),
      referenceImageUrl: extractImageUrlFromCell(shot.referenceImageUrl || shot.参考图 || shot.referenceImage || shot.图片URL || shot.reference_image_url),
      firstFrameUrl: extractImageUrlFromCell(shot.firstFrameUrl || shot.first_frame_url || shot.首帧URL || shot.first_frame || shot.图片URL || shot.reference_image_url),
      lastFrameUrl: extractImageUrlFromCell(shot.lastFrameUrl || shot.last_frame_url || shot.尾帧URL || shot.last_frame),
    }
  }).filter(Boolean) as ImportedShot[]
}
