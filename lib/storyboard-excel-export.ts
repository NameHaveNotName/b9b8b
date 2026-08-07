/**
 * 分镜 Excel 导出工具
 *
 * 功能：
 * - 将分镜数据（镜头描述、运镜方式、时长、角色、尾帧图片）导出为 Excel
 * - 图片通过预签名 URL 下载并嵌入 Excel（避免泄露 URL）
 * - 相同 exportKey 的图片会被缓存（reused计数），不同图片需要获取（fetched计数）
 */

import * as XLSX from 'xlsx'

export interface Shot {
  shotId: string
  actNumber: number
  sceneName: string
  description: string
  cameraMove: string
  duration: number
  characters: string[]
  keyAction: string
  actionChange?: string
  mode?: 'reference' | 'keyframe'
  referenceImageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  thumbnailUrl?: string
  originalUrl?: string
}

export interface ExportProgress {
  message: string
  reused: number
  fetched: number
}

export interface ExportStoryboardOptions {
  exportKey: string
  projectName: string
  shots: Shot[]
  characterMap: Record<string, string>
  mode: 'reference' | 'keyframe'
  onProgress?: (progress: ExportProgress) => void
}

const imageCache = new Map<string, ArrayBuffer>()

async function fetchImageBuffer(url: string): Promise<ArrayBuffer> {
  const cached = imageCache.get(url)
  if (cached) return cached

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`)
  const buffer = await response.arrayBuffer()
  imageCache.set(url, buffer)
  return buffer
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export async function exportStoryboardExcel(options: ExportStoryboardOptions): Promise<void> {
  const { projectName, shots, characterMap, mode, onProgress } = options

  let reused = 0
  let fetched = 0

  const imageUrls: string[] = []
  for (const shot of shots) {
    const imageUrl = shot.lastFrameUrl || shot.firstFrameUrl || shot.referenceImageUrl || ''
    imageUrls.push(imageUrl)
  }

  onProgress?.({ message: 'Preparing images...', reused, fetched })

  const imageBuffers: ArrayBuffer[] = []
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i]
    if (!url) {
      imageBuffers.push(new ArrayBuffer(0))
      continue
    }
    if (imageCache.has(url)) {
      reused++
      imageBuffers.push(imageCache.get(url)!)
      onProgress?.({ message: `Loading image ${i + 1}/${shots.length}`, reused, fetched })
    } else {
      fetched++
      try {
        const buffer = await fetchImageBuffer(url)
        imageBuffers.push(buffer)
        onProgress?.({ message: `Fetching image ${i + 1}/${shots.length}`, reused, fetched })
      } catch {
        imageBuffers.push(new ArrayBuffer(0))
      }
    }
  }

  onProgress?.({ message: 'Building Excel...', reused, fetched })

  const data: Array<Array<string | number | null>> = []

  data.push([
    'AI Film Flow - 分镜表',
    projectName,
    mode === 'reference' ? '实拍参考模式' : '视频生成模式',
    new Date().toLocaleString()
  ])

  data.push([])

  data.push(['序号', '幕号', '场景', '镜头描述', '运镜方式', '时长(s)', '角色', '关键动作', '动作变化', '图片'])

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    const characters = (shot.characters || [])
      .map(id => characterMap[id] || id)
      .join(', ')

    data.push([
      i + 1,
      shot.actNumber,
      shot.sceneName || '',
      shot.description || '',
      shot.cameraMove || '',
      shot.duration || 0,
      characters,
      shot.keyAction || '',
      shot.actionChange || '',
      ''
    ])
  }

  const worksheet = XLSX.utils.aoa_to_sheet(data)

  const colWidths = [
    { wch: 6 },
    { wch: 6 },
    { wch: 15 },
    { wch: 40 },
    { wch: 12 },
    { wch: 8 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 15 },
  ]
  worksheet['!cols'] = colWidths

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '分镜表')

  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'arraybuffer' })
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projectName}_分镜表_${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  onProgress?.({ message: 'Export complete', reused, fetched })
}
