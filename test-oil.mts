import XLSX from 'xlsx'
import { unzipSync, strFromU8 } from 'fflate'
import fs from 'fs'

const filePath = 'C:\\Users\\康泽铭\\Downloads\\重构一滴油的微观宇宙_完整文字分镜表_V3_已插入15张关键镜头.xlsx'
const buffer = fs.readFileSync(filePath)

// SheetJS 解析
const wb = XLSX.read(buffer, { type: 'buffer' })
const sheet = wb.Sheets[wb.SheetNames[0]]
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]

// 评分法表头检测
const SHOT_ID_KW = ['镜号','镜头号','镜头','编号','shot','shot_id','id','序号','分镜号']
const HEADER_BONUS_KW = ['时长','duration','描述','description','景别','运镜','camera','旁白','narration','画面','镜头画面','章节']
let headerRow = -1
let bestScore = 0
for (let i = 0; i < Math.min(30, data.length); i++) {
  const row = data[i]
  if (!row) continue
  let score = 0
  for (const cell of row) {
    const v = String(cell || '').toLowerCase().trim()
    if (SHOT_ID_KW.some(k => v.includes(k))) score += 3
    if (HEADER_BONUS_KW.some(k => v.includes(k))) score += 1
  }
  if (score > bestScore) { bestScore = score; headerRow = i }
}
console.log('headerRow:', headerRow, 'score:', bestScore)
console.log('Header:', (data[headerRow] || []).slice(0, 10))

// shotId 列
let shotIdCol = -1
for (let c = 0; c < (data[headerRow]||[]).length; c++) {
  if (SHOT_ID_KW.some(k => String((data[headerRow]||[])[c]||'').toLowerCase().includes(k))) { shotIdCol = c; break }
}
console.log('shotIdCol:', shotIdCol)

// 数据范围
const dataStart = headerRow + 1
let dataEnd = dataStart
let emptyCount = 0
for (let r = dataStart; r < data.length; r++) {
  const v = shotIdCol >= 0 ? String((data[r]||[])[shotIdCol]||'').trim() : ''
  if (v && /^\d{1,4}$/.test(v)) { dataEnd = r; emptyCount = 0 } else { emptyCount++; if (emptyCount >= 3) break }
}
console.log('dataStart:', dataStart, 'dataEnd:', dataEnd)

// fflate 图片提取
const zipData = unzipSync(new Uint8Array(buffer))
const mediaFiles = new Map<string, Uint8Array>()
for (const [p, d] of Object.entries(zipData)) if (p.startsWith('xl/media/image')) mediaFiles.set(p, d)
console.log('mediaFiles:', mediaFiles.size)

// drawing rels
const drawingFiles = Object.keys(zipData).filter(k => /^xl\/drawings\/drawing\d+\.xml$/.test(k))
console.log('drawingFiles:', drawingFiles)

if (drawingFiles.length > 0 && mediaFiles.size > 0) {
  const drawingPath = drawingFiles[0]
  const drp = drawingPath.replace(/drawing(\d+)\.xml$/, '_rels/drawing$1.xml.rels')
  const dr = zipData[drp] ? strFromU8(zipData[drp]) : ''
  const ridMap = new Map<string, string>()
  const re = /(?:Id="([^"]+)"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="([^"]+)")/g
  let m
  while ((m = re.exec(dr)) !== null) {
    const rid = m[1] || m[4]
    let target = m[2] || m[3]
    if (target.startsWith('/')) target = target.substring(1)
    else target = 'xl/' + target.replace(/^\.\.\//, '')
    ridMap.set(rid, target)
  }
  console.log('ridMap:', ridMap.size)
  
  // drawing XML
  const dx = strFromU8(zipData[drawingPath])
  const are = /<xdr:(?:one|two|absolute)CellAnchor[^>]*>([\s\S]*?)<\/xdr:(?:one|two|absolute)CellAnchor>/g
  const positions: Array<{row:number,col:number,mp:string}> = []
  let am
  while ((am = are.exec(dx)) !== null) {
    const a = am[1]
    const fm = a.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/)
    let col = -1, row = -1
    if (fm) {
      const cm = fm[1].match(/<xdr:col>(\d+)<\/xdr:col>/)
      const rm = fm[1].match(/<xdr:row>(\d+)<\/xdr:row>/)
      if (cm) col = parseInt(cm[1])
      if (rm) row = parseInt(rm[1])
    }
    if (row < 0 || col < 0) {
      const pm = a.match(/<xdr:pos[^>]*x="(\d+)"[^>]*y="(\d+)"/)
      if (pm) { col = Math.floor(parseInt(pm[1])/576000); row = Math.floor(parseInt(pm[2])/190500) }
    }
    if (row < 0 || col < 0) continue
    const bm = a.match(/<a:blip[^>]*r:embed="([^"]+)"/)
    if (!bm) continue
    const mp = ridMap.get(bm[1])
    if (mp && mediaFiles.has(mp)) positions.push({row,col,mp})
  }
  console.log('imagePositions:', positions.length)
  if (positions.length > 0) {
    console.log('First 5 positions:')
    for (const p of positions.slice(0, 5)) {
      console.log(`  row=${p.row} col=${p.col} mp=${p.mp}`)
    }
  }
  
  // 匹配
  let matched = 0
  for (const pos of positions) {
    const imgRow = pos.row + 1
    if (imgRow < dataStart) {
      console.log(`  SKIP img at row ${pos.row} (imgRow=${imgRow} < dataStart=${dataStart})`)
      continue
    }
    const cellVal = shotIdCol >= 0 ? String((data[imgRow - 1] || [])[shotIdCol] || '').trim() : ''
    const isMatch = cellVal && /^\d{1,4}$/.test(cellVal)
    if (isMatch) matched++
    console.log(`  img row=${pos.row} imgRow=${imgRow} cellVal="${cellVal}" match=${isMatch}`)
  }
  console.log(`\nmatched: ${matched}/${positions.length}`)
}
