/**
 * 临时目录工具（从 video-utils.ts 独立出来，避免构建缓存导致旧代码不生效）
 */

import * as fsSync from 'fs'
import * as path from 'path'

let _writableTempRoot: string | undefined

function detectWritableTempRoot(): string {
  if (_writableTempRoot) return _writableTempRoot

  if (process.env.TEMP_DIR) {
    const root = path.resolve(process.env.TEMP_DIR)
    _writableTempRoot = root
    return root
  }

  // Linux/macOS Serverless (Vercel/Lambda/Docker): /tmp 可写
  // Windows 本地开发: 回退到项目 .temp
  if (process.platform === 'win32') {
    _writableTempRoot = path.join(process.cwd(), '.temp')
    return _writableTempRoot
  }

  _writableTempRoot = '/tmp'
  return '/tmp'
}

/** 在可写临时目录下建一个本轮专用的子目录，方便事后批量清理 */
export function makeTempDir(prefix = 'trailer-'): string {
  const tempRoot = detectWritableTempRoot()
  console.log(`[TEMP] platform=${process.platform} tempRoot=${tempRoot}`)
  if (!fsSync.existsSync(tempRoot)) {
    fsSync.mkdirSync(tempRoot, { recursive: true })
  }
  const dir = path.join(tempRoot, `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  console.log(`[TEMP] makeTempDir: ${dir}`)
  return dir
}
