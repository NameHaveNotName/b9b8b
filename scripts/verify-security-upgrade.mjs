import assert from 'node:assert/strict'
import sharp from 'sharp'
import * as XLSX from 'xlsx'

const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="#222"/></svg>'
)
const png = await sharp(svg).png().toBuffer()
const metadata = await sharp(png).metadata()
assert.equal(metadata.format, 'png')
assert.equal(metadata.width, 32)
assert.equal(metadata.height, 18)

await assert.rejects(() => sharp(Buffer.from('not-an-image')).metadata())

const worksheet = XLSX.utils.aoa_to_sheet([
  ['shot', 'duration'],
  ['opening', 3],
])
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, worksheet, 'Storyboard')
const workbookBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })
assert.ok(workbookBytes.length > 100)
assert.equal(workbookBytes.subarray(0, 2).toString('ascii'), 'PK')

console.log('security upgrade media checks passed')
