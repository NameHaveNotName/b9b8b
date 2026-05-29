/**
 * 通过 xiaomi.ts 中的 generateMusicMinimax 测试 MiniMax 官方 API
 * 运行: npx tsx scripts/test-minimax-via-xiaomi.ts --yes
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

const _confirmed = process.argv.includes('--yes')
if (!_confirmed) {
  console.error('⚠️  加 --yes 才会发请求(官方 API 生成约需 2 分钟)')
  process.exit(0)
}

;(async () => {
  console.log('[TEST] 通过 generateMusicMinimax 调用 MiniMax 官方 API')
  console.log('MINIMAX_API_KEY:', (process.env.MINIMAX_API_KEY || '').slice(0, 20) + '...')

  // 动态导入,确保 dotenv 已先加载
  const { generateMusicMinimax } = await import('../lib/api-clients/xiaomi')

  try {
    const res = await generateMusicMinimax({
      prompt: 'Epic cinematic trailer music, orchestral, dramatic, intense battle scene',
      isInstrumental: true,
      outputFormat: 'url',
    })
    console.log('✅ 成功!')
    console.log('  model:', res.model)
    console.log('  outputFormat:', res.outputFormat)
    console.log('  url:', res.url.slice(0, 80))
  } catch (err: any) {
    console.error('❌ 失败:', err?.message || err)
    process.exit(1)
  }
})()
