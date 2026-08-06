/**
 * 清理孤立缩略图脚本
 * 
 * 使用方法：
 *   npx ts-node scripts/cleanup-thumbnails.ts          # 预览模式（不实际删除）
 *   npx ts-node scripts/cleanup-thumbnails.ts --yes    # 执行删除
 */

import { deleteProjectFolder } from '../lib/r2'

interface CleanupOptions {
  dryRun: boolean
  projectId?: string
}

async function parseArgs(): Promise<CleanupOptions> {
  const args = process.argv.slice(2)
  return {
    dryRun: !args.includes('--yes'),
    projectId: args.find(arg => arg.startsWith('--project='))?.split('=')[1],
  }
}

async function main() {
  const options = await parseArgs()
  
  console.log('='.repeat(60))
  console.log('缩略图清理工具')
  console.log('='.repeat(60))
  console.log(`模式: ${options.dryRun ? '预览（不删除）' : '执行删除'}`)
  if (options.projectId) {
    console.log(`项目: ${options.projectId}`)
  }
  console.log('='.repeat(60))

  if (options.dryRun) {
    console.log('\n[预览模式] 实际不会删除任何文件')
    console.log('添加 --yes 参数执行实际删除\n')
  }

  try {
    const { cleanupOrphanedThumbnails } = await import('../lib/r2')
    
    console.log('\n开始扫描孤立缩略图...')
    
    if (options.dryRun) {
      console.log('[注意] 预览模式下不会显示具体文件，只显示数量统计')
    }

    const result = await cleanupOrphanedThumbnails()
    
    console.log(`\n清理完成:`)
    console.log(`  删除的孤立缩略图数量: ${result.deletedCount}`)
    
    if (options.dryRun) {
      console.log('\n[预览模式] 如需执行删除，请重新运行并添加 --yes 参数')
    } else {
      console.log('\n[完成] 所有孤立缩略图已清理')
    }
  } catch (error) {
    console.error('\n清理失败:', error)
    process.exit(1)
  }
}

main()
