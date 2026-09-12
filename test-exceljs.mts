import ExcelJS from 'exceljs'
import fs from 'fs'

async function main() {
  const buffer = fs.readFileSync('D:\\.pogget\\user_storage\\u_461180\\40f6b\\outputs\\text_storyboard\\信念陪伴.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as any)
  const ws = workbook.worksheets[0]

  console.log('=== HEADER ROW 3 ===')
  const row3 = ws.getRow(3)
  row3.eachCell((cell, colNumber) => {
    console.log(`  col ${colNumber}: "${cell.value}"`)
  })

  console.log('\n=== IMAGE METADATA (first 5) ===')
  const imageMetas = ws.getImages() as any[]
  console.log('Total images:', imageMetas.length)
  for (const meta of imageMetas.slice(0, 5)) {
    console.log(`  imageId=${meta.imageId}, tl.col=${meta.range.tl.nativeCol}, tl.row=${meta.range.tl.nativeRow}, br.col=${meta.range.br.nativeCol}, br.row=${meta.range.br.nativeRow}`)
  }

  console.log('\n=== IMAGE COL COUNTS ===')
  const colCounts = new Map<number, number>()
  for (const meta of imageMetas) {
    const col = meta.range.tl.nativeCol + 1
    colCounts.set(col, (colCounts.get(col) || 0) + 1)
  }
  for (const [col, count] of colCounts) {
    console.log(`  col ${col}: ${count} images`)
  }

  console.log('\n=== getImage test ===')
  try {
    const img = workbook.getImage(imageMetas[0].imageId)
    console.log('  type:', typeof img, 'length:', img ? (img as any).length || 'N/A' : 'null')
  } catch (e: any) {
    console.log('  ERROR:', e.message)
  }
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
