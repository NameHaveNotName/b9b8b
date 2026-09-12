import ExcelJS from 'exceljs'
import fs from 'fs'

const IMAGE_KEYWORDS = ['分镜图片', '图片', 'image', 'pic', '参考图', '示意图', '画面', '分镜图', '截图', '缩略图']

async function main() {
  const buffer = fs.readFileSync('D:\\.pogget\\user_storage\\u_461180\\40f6b\\outputs\\text_storyboard\\信念陪伴.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as any)
  const ws = workbook.worksheets[0]

  console.log('=== Testing detectImageColByKeyword ===')
  const headerRow = 3
  const row = ws.getRow(headerRow)
  let bestCol = null
  let bestLabel = ''

  row.eachCell((cell, colNumber) => {
    const val = String(cell.value || '').toLowerCase().trim()
    console.log(`  col ${colNumber}: raw="${cell.value}" lower="${val}"`)
    for (const keyword of IMAGE_KEYWORDS) {
      if (val.includes(keyword)) {
        console.log(`    MATCH! keyword="${keyword}" col=${colNumber}`)
        bestCol = colNumber
        bestLabel = String(cell.value || '')
        return
      }
    }
  })

  console.log('\nResult:', { col: bestCol, label: bestLabel })

  // Test with manual iteration
  console.log('\n=== Manual iteration ===')
  for (let c = 1; c <= 13; c++) {
    const cell = ws.getCell(headerRow, c)
    const val = String(cell.value || '').toLowerCase().trim()
    const hasKeyword = IMAGE_KEYWORDS.some(k => val.includes(k))
    console.log(`  col ${c}: "${cell.value}" hasKeyword=${hasKeyword}`)
  }
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
