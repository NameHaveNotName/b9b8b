import ExcelJS from 'exceljs'
import fs from 'fs'

async function main() {
  const buffer = fs.readFileSync('D:\\.pogget\\user_storage\\u_461180\\40f6b\\outputs\\text_storyboard\\信念陪伴.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as any)
  const ws = workbook.worksheets[0]

  const imageMetas = ws.getImages() as any[]
  console.log('Total images:', imageMetas.length)

  console.log('\n=== IMAGE POSITIONS ===')
  const colCounts = new Map<number, number>()
  for (let i = 0; i < imageMetas.length; i++) {
    const meta = imageMetas[i]
    const range = meta.range
    if (range && range.tl) {
      const row = range.tl.nativeRow + 1
      const col = range.tl.nativeCol + 1
      colCounts.set(col, (colCounts.get(col) || 0) + 1)
      if (i < 5) console.log(`  img${i}: row=${row}, col=${col}, imageId=${meta.imageId}`)
    } else {
      console.log(`  img${i}: range=`, range)
    }
  }

  console.log('\n=== COL COUNTS ===')
  for (const [col, count] of colCounts) {
    console.log(`  col ${col}: ${count} images`)
  }

  console.log('\n=== getImage test ===')
  try {
    const img = workbook.getImage(imageMetas[0].imageId)
    if (img) {
      const buf = (img as any).buffer || img
      console.log('  result type:', typeof img, 'has buffer:', !!(img as any).buffer, 'buffer length:', buf?.length || (img as any).length || 'N/A')
    }
  } catch (e: any) {
    console.log('  ERROR:', e.message)
  }
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
