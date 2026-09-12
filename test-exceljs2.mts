import ExcelJS from 'exceljs'
import fs from 'fs'

async function main() {
  const buffer = fs.readFileSync('D:\\.pogget\\user_storage\\u_461180\\40f6b\\outputs\\text_storyboard\\信念陪伴.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as any)
  const ws = workbook.worksheets[0]

  console.log('=== IMAGE METADATA STRUCTURE ===')
  const imageMetas = ws.getImages() as any[]
  console.log('Total images:', imageMetas.length)
  if (imageMetas.length > 0) {
    const meta = imageMetas[0]
    console.log('Keys:', Object.keys(meta))
    console.log('Full meta:', JSON.stringify(meta, null, 2).slice(0, 500))
  }

  console.log('\n=== ALL IMAGE POSITIONS ===')
  for (let i = 0; i < Math.min(10, imageMetas.length); i++) {
    const meta = imageMetas[i]
    try {
      const tl = meta.range?.tl || meta.tl
      const row = tl?.nativeRow != null ? tl.nativeRow + 1 : 'N/A'
      const col = tl?.nativeCol != null ? tl.nativeCol + 1 : 'N/A'
      console.log(`  img${i}: row=${row}, col=${col}`)
    } catch (e: any) {
      console.log(`  img${i}: ERROR - ${e.message}`)
      console.log('    meta:', JSON.stringify(meta).slice(0, 200))
    }
  }

  console.log('\n=== getImage test ===')
  try {
    const img = workbook.getImage(imageMetas[0].imageId)
    if (img) {
      const buf = img.buffer || img
      console.log('  type:', typeof img, 'buffer length:', buf?.length || 'N/A')
    } else {
      console.log('  null result')
    }
  } catch (e: any) {
    console.log('  ERROR:', e.message)
  }
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
