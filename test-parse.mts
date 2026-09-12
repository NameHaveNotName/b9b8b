import { parseXlsxWithImages } from './lib/storyboard-xlsx-parser'
import fs from 'fs'

async function main() {
  console.log('Loading xlsx...')
  const buffer = fs.readFileSync('D:\\.pogget\\user_storage\\u_461180\\40f6b\\outputs\\text_storyboard\\信念陪伴.xlsx')
  console.log('File size:', buffer.length, 'bytes')

  const result = await parseXlsxWithImages(buffer)

  console.log('=== RESULT ===')
  console.log('type:', result.type)
  console.log('shots:', result.shots.length)
  console.log('totalImages:', result.totalImages)
  console.log('matchedImages:', result.matchedImages)
  console.log('headerRow:', result.headerRow)
  console.log('dataRange:', result.dataStartRow, '-', result.dataEndRow)
  console.log('shotIdCol:', result.columnDetection.shotIdCol)
  console.log('imageCol:', result.columnDetection.imageCol)
  console.log('needsShotIdSelection:', result.needsShotIdSelection)
  console.log('needsImageColSelection:', result.needsImageColSelection)

  console.log('\n=== FIRST 5 SHOTS ===')
  for (const s of result.shots.slice(0, 5)) {
    console.log(`  ${s.shotId} | ${s.description?.slice(0, 50)} | camera: ${s.cameraMove}`)
  }

  console.log('\n=== IMAGE DISTRIBUTION ===')
  const shotImageMap: Record<string, number> = {}
  for (const img of result.images) {
    shotImageMap[img.shotId] = (shotImageMap[img.shotId] || 0) + 1
  }
  const entries = Object.entries(shotImageMap)
  console.log(`shots with images: ${entries.length}/${result.shots.length}`)
  for (const [k, v] of entries.slice(0, 10)) {
    console.log(`  shot ${k}: ${v} imgs`)
  }
  if (entries.length > 10) console.log(`  ...and ${entries.length - 10} more`)

  console.log('\n=== DONE ===')
}

main().catch(e => {
  console.error('ERROR:', e.message)
  console.error(e.stack)
  process.exit(1)
})
