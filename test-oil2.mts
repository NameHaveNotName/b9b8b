import { unzipSync, strFromU8 } from 'fflate'
import fs from 'fs'

const filePath = 'C:\\Users\\康泽铭\\Downloads\\重构一滴油的微观宇宙_完整文字分镜表_V3_已插入15张关键镜头.xlsx'
const buffer = fs.readFileSync(filePath)
const zipData = unzipSync(new Uint8Array(buffer))

const dx = strFromU8(zipData['xl/drawings/drawing1.xml'])
console.log('Drawing XML length:', dx.length)
console.log('\nDrawing XML (first 3000 chars):')
console.log(dx.slice(0, 3000))

// 检查 anchor 类型
const anchorTypes = dx.match(/<xdr:\w+Anchor/g)
console.log('\nAnchor types found:', [...new Set(anchorTypes || [])])

// 检查 blip
const blips = dx.match(/<a:blip[^>]+>/g)
console.log('Blip tags:', blips?.length || 0)
if (blips && blips.length > 0) {
  console.log('First blip:', blips[0])
}

// 检查是否有 xdr:from
const fromMatches = dx.match(/<xdr:from>/g)
console.log('from tags:', fromMatches?.length || 0)

// 检查是否有 xdr:twoCellAnchor
const twoCell = dx.match(/<xdr:twoCellAnchor/g)
console.log('twoCellAnchor tags:', twoCell?.length || 0)

// 检查是否有 xdr:oneCellAnchor
const oneCell = dx.match(/<xdr:oneCellAnchor/g)
console.log('oneCellAnchor tags:', oneCell?.length || 0)

// 检查是否有 xdr:pic
const pics = dx.match(/<xdr:pic/g)
console.log('pic tags:', pics?.length || 0)
