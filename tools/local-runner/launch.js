/* eslint-disable no-console */
const { execFileSync, spawn } = require('child_process')
const path = require('path')

function normalizeProxy(value) {
  if (!value) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const first = raw.includes(';')
    ? raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('https='))?.slice(6)
      || raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('http='))?.slice(5)
    : raw
  if (!first) return ''
  return /^https?:\/\//i.test(first) ? first : `http://${first}`
}

function readWindowsProxy() {
  if (process.platform !== 'win32') return ''
  try {
    const script = [
      "$p = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'",
      "if ($p.ProxyEnable -eq 1) { $p.ProxyServer }",
    ].join('; ')
    return normalizeProxy(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }))
  } catch {
    return ''
  }
}

const env = { ...process.env }
const proxyMode = String(env.LOCAL_RUNNER_PROXY || '').trim().toLowerCase()
const proxyDisabled = ['0', 'false', 'off', 'none', 'direct'].includes(proxyMode)
const explicitProxy = normalizeProxy(env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY)
const systemProxy = proxyMode === 'system' || proxyMode === 'auto' || (!proxyMode && process.platform === 'win32') ? readWindowsProxy() : ''
const proxy = proxyDisabled ? '' : (explicitProxy || systemProxy)
if (proxy) {
  env.HTTP_PROXY = env.HTTP_PROXY || proxy
  env.HTTPS_PROXY = env.HTTPS_PROXY || proxy
  env.ALL_PROXY = env.ALL_PROXY || proxy
  env.NODE_USE_ENV_PROXY = env.NODE_USE_ENV_PROXY || '1'
  console.log(`本地 runner 将使用代理：${proxy}`)
} else {
  delete env.HTTP_PROXY
  delete env.HTTPS_PROXY
  delete env.ALL_PROXY
  delete env.NODE_USE_ENV_PROXY
  console.log('本地 runner 将直连服务器；如需强制使用系统代理，请设置 LOCAL_RUNNER_PROXY=system 后重启。')
}

const major = Number(process.versions.node.split('.')[0])
const args = []
if (major >= 24 && proxy) args.push('--use-env-proxy')
args.push(path.join(__dirname, 'server.js'))

const child = spawn(process.execPath, args, { stdio: 'inherit', env })
setTimeout(() => {
  const url = `http://localhost:${env.LOCAL_RUNNER_PORT || 4317}`
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {}
}, 1500)
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
