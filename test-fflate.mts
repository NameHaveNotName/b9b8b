import { unzipSync, strFromU8 } from 'fflate'
import XLSX from 'xlsx'
import fs from 'fs'

const buffer = fs.readFileSync('D:\\.pogget\\user_storage\\u_461180\\40f6b\\outputs\\text_storyboard\\信念陪伴.xlsx')

// 1. SheetJS 解析数据
const workbook = XLSX.read(buffer, { type: 'buffer' })
const sheet = workbook.Sheets[workbook.SheetNames[0]]
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]

// 检测表头
const SHOT_ID_KW = ['镜号', '镜头号', '镜头', '编号', 'shot', 'shot_id', 'id', '序号']
let headerRow = -1
for (let i = 0; i < Math.min(30, data.length); i++) {
  const row = data[i]
  if (!row) continue
  for (let c = 0; c < Math.min(10, row.length); c++) {
    const v = String(row[c] || '').toLowerCase().trim()
    if (SHOT_ID_KW.some(k => v.includes(k))) {
      headerRow = i
      console.log(`Found header at row ${i}, col ${c}: "${row[c]}"`)
      break
    }
  }
  if (headerRow >= 0) break
}
console.log('headerRow:', headerRow)

if (headerRow < 0) {
  console.log('First 5 rows:')
  for (let i = 0; i < Math.min(5, data.length); i++) {
    console.log(`  row ${i}:`, (data[i] || []).slice(0, 5).map((c: any) => String(c || '').slice(0, 20)))
  }
}

// 2. fflate 解压
const zipData = unzipSync(new Uint8Array(buffer))

// 找媒体文件
const mediaFiles = new Map<string, Uint8Array>()
for (const [path, d] of Object.entries(zipData)) {
  if (path.startsWith('xl/media/image')) mediaFiles.set(path, d)
}
console.log('media files:', mediaFiles.size)

// 找 sheet1 的 drawing 引用
const sheetRelsPath = 'xl/worksheets/_rels/sheet1.xml.rels'
const sheetRels = zipData[sheetRelsPath] ? strFromU8(zipData[sheetRelsPath]) : ''
const drawingRefMatch = sheetRels.match(/Target="([^"]*drawing[^"]*)"/i)
const drawingPath = drawingRefMatch ? 'xl/' + drawingRefMatch[1].replace(/^\.\.\//, '') : null
console.log('drawingPath:', drawingPath)

if (drawingPath && zipData[drawingPath]) {
  // 解析 drawing rels
  // xl/drawings/drawing1.xml → xl/drawings/_rels/drawing1.xml.rels
  const lastSlash = drawingPath.lastIndexOf('/')
  const drawingDir = drawingPath.substring(0, lastSlash)
  const drawingFile = drawingPath.substring(lastSlash + 1)
  const drawingRelsPath = `${drawingDir}/_rels/${drawingFile}.rels`
  console.log('drawingRelsPath:', drawingRelsPath)
  console.log('drawingRels exists:', !!zipData[drawingRelsPath])
  const drawingRels = zipData[drawingRelsPath] ? strFromU8(zipData[drawingRelsPath]) : ''
  console.log('drawingRels content (first 500):', drawingRels.slice(0, 500))
  const ridToMedia = new Map<string, string>()
  const ridRegex = /Id="([^"]+)"[^>]*Target="([^"]+)"/g
  let m
  while ((m = ridRegex.exec(drawingRels)) !== null) {
    ridToMedia.set(m[1], 'xl/' + m[2].replace(/^\.\.\//, ''))
  }
  console.log('ridToMedia entries:', ridToMedia.size)

  // 解析 drawing XML
  const drawingXml = strFromU8(zipData[drawingPath])
  console.log('drawingXml length:', drawingXml.length)
  console.log('drawingXml first 1000:', drawingXml.slice(0, 1000))
  const anchorRegex = /<xdr:(?:one|two)CellAnchor[^>]*>([\s\S]*?)<\/xdr:(?:one|two)CellAnchor>/g
  const positions: Array<{ row: number; col: number; mediaPath: string }> = []
  let am
  while ((am = anchorRegex.exec(drawingXml)) !== null) {
    const anchor = am[1]
    const fromMatch = anchor.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/)
    if (!fromMatch) continue
    const colM = fromMatch[1].match(/<xdr:col>(\d+)<\/xdr:col>/)
    const rowM = fromMatch[1].match(/<xdr:row>(\d+)<\/xdr:row>/)
    if (!colM || !rowM) continue
    const blipMatch = anchor.match(/<a:blip[^>]*r:embed="([^"]+)"/)
    if (!blipMatch) continue
    const mediaPath = ridToMedia.get(blipMatch[1])
    if (mediaPath && mediaFiles.has(mediaPath)) {
      positions.push({ row: parseInt(rowM[1]), col: parseInt(colM[1]), mediaPath })
    }
  }

  console.log('image positions found:', positions.length)
  if (positions.length > 0) {
    console.log('First 5 positions:')
    for (const p of positions.slice(0, 5)) {
      console.log(`  row=${p.row}, col=${p.col}, path=${p.mediaPath}`)
    }
  }

  // 匹配到分镜（假设 shotIdCol=0）
  const shotIdCol = 0
  const dataStart = headerRow >= 0 ? headerRow + 1 : 3
  let matched = 0
  for (const pos of positions) {
    const imgRow = pos.row + 1
    if (imgRow < dataStart) continue
    const cellVal = String((data[imgRow - 1] || [])[shotIdCol] || '').trim()
    if (cellVal && /^\d{1,4}$/.test(cellVal)) {
      matched++
      if (matched <= 5) console.log(`  img at row ${imgRow} → shot ${cellVal}`)
    }
  }
  console.log(`matched images: ${matched}/${positions.length}`)
} else {
  console.log('No drawing found')
  console.log('Available drawing files:', Object.keys(zipData).filter(k => k.includes('drawing')))
}
