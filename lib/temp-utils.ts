/**
 * 临时目录工具（从 video-utils.ts 独立出来，避免构建缓存导致旧代码不生效）
 *
 * Vercel Serverless 文件系统规则：
 * - /var/task 只读（代码目录）
 * - /tmp 可写（临时目录，每次调用独立）
 * 因此非 Windows 环境直接强制使用 /tmp，不做任何回退到 process.cwd() 的操作。
 */

import * as fsSync from 'fs'
import * as path from 'path'

let _writableTempRoot: string | undefined

function detectWritableTempRoot(): string {
  if (_writableTempRoot) return _writableTempRoot

  // 1) 环境变量最高优先级（便于本地 Docker/测试覆盖）
  if (process.env.TEMP_DIR) {
    const root = path.resolve(process.env.TEMP_DIR)
    _writableTempRoot = root
    console.log(`[TEMP] 使用环境变量 TEMP_DIR: ${root}`)
    return root
  }

  // 2) Windows 本地开发回退到项目 .temp
  if (process.platform === 'win32') {
    const root = path.join(process.cwd(), '.temp')
    _writableTempRoot = root
    console.log(`[TEMP] Windows 本地开发，使用: ${root}`)
    return root
  }

  // 3) Linux/macOS Serverless（Vercel/Lambda/Docker）：强制 /tmp
  const root = '/tmp'
  _writableTempRoot = root
  console.log(`[TEMP] Serverless 环境，强制使用: ${root}`)
  return root
}

/** 在可写临时目录下建一个本轮专用的子目录，方便事后批量清理 */
export function makeTempDir(prefix = 'trailer-'): string {
  const tempRoot = detectWritableTempRoot()
  console.log(`[TEMP] platform=${process.platform} tempRoot=${tempRoot}`)

  try {
    if (!fsSync.existsSync(tempRoot)) {
      fsSync.mkdirSync(tempRoot, { recursive: true })
    }
  } catch (err: any) {
    console.error(`[TEMP] 创建 tempRoot 失败: ${tempRoot}, err=${err?.message}`)
    // 兜底：如果 /tmp 都建不了，尝试 /var/tmp
    if (tempRoot !== '/var/tmp') {
      _writableTempRoot = '/var/tmp'
      return makeTempDir(prefix)
    }
    throw err
  }

  const dir = path.join(tempRoot, `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  console.log(`[TEMP] makeTempDir: ${dir}`)
  return dir
}
