import { editImage } from '@/lib/api-clients/xiaomi'
import * as fs from 'fs'
import * as path from 'path'

async function test() {
  console.log('Testing editImage endpoint...')
  
  const imgDir = path.join(process.cwd(), 'test-7-models')
  const sourceImage = path.join(imgDir, 'Grok_4_2___X平台_grok-4.2-image.png')
  
  if (!fs.existsSync(sourceImage)) {
    console.log('源图不存在，跳过测试')
    return
  }
  
  // gpt-image-1 在文档中明确支持 edits 端点
  const result = await editImage({
    image: sourceImage,
    prompt: 'add a small red lantern floating in the sky',
    model: 'gpt-image-1',
    size: '1024x1024',
  })
  
  const outPath = path.join(imgDir, 'edited_grok_lantern.png')
  fs.writeFileSync(outPath, result.buffer)
  console.log(`Saved edited image: ${outPath} (${(result.buffer.length / 1024).toFixed(1)} KB)`)
}
test().catch(e => { console.error('Error:', e.message); process.exit(1) })
