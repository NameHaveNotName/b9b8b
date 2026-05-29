import { generateImage } from '@/lib/api-clients/xiaomi'
import * as fs from 'fs'
import * as path from 'path'

async function test() {
  console.log('Testing Gemini Flash...')
  const result = await generateImage({
    model: 'gemini-3.1-flash-image',
    prompt: 'Cinematic wide shot, golden hour lighting, a lone samurai on a cliff',
    referenceImageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512&h=512&fit=crop',
    aspectRatio: '16:9',
  })
  console.log('Result:', { model: result.model, isMock: result.isMock, bufferLen: result.buffer.length })
  if (!result.isMock) {
    const dir = path.join(process.cwd(), 'test-7-models')
    fs.writeFileSync(path.join(dir, 'Gemini_test_fixed.png'), result.buffer)
    console.log('Saved Gemini_test_fixed.png')
  }
}
test().catch(e => { console.error('Error:', e.message); process.exit(1) })
