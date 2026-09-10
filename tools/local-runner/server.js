/* eslint-disable no-console */
const http = require('http')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { URL } = require('url')
const { spawn } = require('child_process')

const PORT = Number(process.env.LOCAL_RUNNER_PORT || 4317)
const ROOT = path.resolve(__dirname, '..', '..')
const STATE_DIR = path.join(ROOT, '.local-runner')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const DEFAULT_SERVER = 'https://b9b8b.vercel.app'
const AUTH_DEBUG_PORT = Number(process.env.LOCAL_RUNNER_AUTH_PORT || 9223)

const STEP_LABELS = {
  IDEATION: '创意扩散',
  FRAMEWORK: '框架搭建',
  STYLE: '风格统一',
  CHARACTER: '人物设计',
  CONCEPT: '概念图',
  TRAILER: '宣传片',
  STORYBOARD: '分镜设计',
  KEYFRAMES: '生成尾帧',
  VIDEO_DIRECT: '直生视频',
}

const FLOW = [
  'IDEATION',
  'FRAMEWORK',
  'STYLE',
  'CHARACTER',
  'CONCEPT',
  'TRAILER',
  'STORYBOARD',
  'KEYFRAMES',
  'VIDEO_DIRECT',
]

const SKIPPED = new Set(['CONCEPT', 'TRAILER', 'KEYFRAMES'])

const STEP_ROUTE = {
  IDEATION: 'ideation',
  FRAMEWORK: 'framework',
  STYLE: 'style',
  CHARACTER: 'character',
  STORYBOARD: 'storyboard',
  VIDEO_DIRECT: 'video-direct',
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function initialState() {
  return {
    config: {
      serverUrl: DEFAULT_SERVER,
      projectUrl: '',
      projectId: '',
      cookie: '',
      saveDir: path.join(process.env.USERPROFILE || ROOT, 'Downloads', 'AI影视生成结果'),
      pollMs: 15000,
      itemDelayMs: 5000,
      requestTimeoutMs: 600000,
      aspectRatio: '16:9',
      directionIndex: null,
    },
    runner: {
      running: false,
      paused: false,
      pauseReason: '',
      currentStep: '',
      lastMessage: '未启动',
      lastError: '',
      waitingForManualContinue: false,
      completedSteps: {},
      skippedSteps: Object.fromEntries([...SKIPPED].map((s) => [s, true])),
      startedAt: null,
      updatedAt: new Date().toISOString(),
    },
    downloads: {
      items: [],
      downloaded: {},
    },
    logs: [],
  }
}

let state = initialState()
let loopActive = false
let activeLoopEpoch = 0
let runnerEpoch = 0

async function ensureStateDir() {
  await fsp.mkdir(STATE_DIR, { recursive: true })
}

async function loadState() {
  await ensureStateDir()
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8')
    const saved = JSON.parse(raw)
    state = {
      ...initialState(),
      ...saved,
      config: { ...initialState().config, ...(saved.config || {}) },
      runner: { ...initialState().runner, ...(saved.runner || {}), running: false },
      downloads: { ...initialState().downloads, ...(saved.downloads || {}) },
      logs: saved.logs || [],
    }
  } catch {
    state = initialState()
  }
}

async function saveState() {
  await ensureStateDir()
  state.runner.updatedAt = new Date().toISOString()
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function log(message, level = 'info') {
  const item = { time: new Date().toISOString(), level, message }
  state.logs.unshift(item)
  state.logs = state.logs.slice(0, 400)
  console.log(`[local-runner] ${message}`)
}

function setMessage(message) {
  state.runner.lastMessage = message
  log(message)
}

function setError(message) {
  state.runner.lastError = message
  log(message, 'error')
}

function resetLocalProgress(message, options = {}) {
  runnerEpoch += 1
  const fresh = initialState()
  state.runner = {
    ...fresh.runner,
    lastMessage: message,
  }
  state.downloads = fresh.downloads
  if (options.clearDirectionIndex) state.config.directionIndex = null
  log(message)
}

function normalizeServerUrl(input) {
  const value = String(input || DEFAULT_SERVER).trim().replace(/\/+$/, '')
  return value || DEFAULT_SERVER
}

function parseProjectId(input) {
  const value = String(input || '').trim()
  if (!value) return ''
  const match = value.match(/\/project\/([^/?#]+)/)
  if (match) return match[1]
  return value
}

function apiUrl(pathname) {
  return `${state.config.serverUrl.replace(/\/+$/, '')}${pathname}`
}

function headers(json = false) {
  const h = {
    Accept: 'application/json',
    'User-Agent': 'AI-Film-Flow-Local-Runner/1.0',
  }
  if (state.config.cookie) h.Cookie = state.config.cookie
  if (json) h['Content-Type'] = 'application/json'
  return h
}

function findEdgeExecutable() {
  if (process.platform !== 'win32') {
    return process.env.EDGE_PATH || 'microsoft-edge'
  }
  const candidates = [
    process.env.EDGE_PATH,
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(p)) || 'msedge.exe'
}

function getAuthUrl() {
  const server = normalizeServerUrl(state.config.serverUrl || DEFAULT_SERVER)
  return `${server}/login`
}

async function launchAuthBrowser() {
  await ensureStateDir()
  const userDataDir = path.join(STATE_DIR, 'edge-auth-profile')
  await fsp.mkdir(userDataDir, { recursive: true })
  const edge = findEdgeExecutable()
  const args = [
    `--remote-debugging-port=${AUTH_DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-default-apps',
    getAuthUrl(),
  ]
  const child = spawn(edge, args, { detached: true, stdio: 'ignore' })
  child.unref()
  log(`已打开专用登录窗口。请在 Edge 窗口完成登录，然后回到本工具点击“我已登录，自动授权”。`)
  return { port: AUTH_DEBUG_PORT, url: getAuthUrl() }
}

async function getCdpJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${AUTH_DEBUG_PORT}${pathname}`, {
    signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
  })
  if (!res.ok) throw new Error(`CDP_HTTP_${res.status}`)
  return res.json()
}

async function cdpCommand(webSocketDebuggerUrl, method, params = {}) {
  if (typeof WebSocket !== 'function') {
    throw new Error('当前 Node 版本不支持自动读取登录态，请安装 Node.js 22 或更新版本，或手动粘贴 Cookie。')
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl)
    const id = 1
    const timer = setTimeout(() => {
      try { ws.close() } catch {}
      reject(new Error('读取浏览器登录态超时，请确认专用 Edge 登录窗口仍然打开。'))
    }, 10000)
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }))
    })
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(String(event.data || '{}'))
      if (data.id !== id) return
      clearTimeout(timer)
      try { ws.close() } catch {}
      if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)))
      else resolve(data.result || {})
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('无法连接专用 Edge 登录窗口，请先点击“打开登录窗口”。'))
    })
  })
}

function cookieHeaderFromCdpCookies(cookies, serverUrl) {
  const host = new URL(serverUrl).hostname
  const matched = (cookies || []).filter((cookie) => {
    const domain = String(cookie.domain || '').replace(/^\./, '')
    return domain && (host === domain || host.endsWith(`.${domain}`))
  })
  if (!matched.length) return ''
  return matched.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

async function captureAuthCookies() {
  const version = await getCdpJson('/json/version')
  let wsUrl = version.webSocketDebuggerUrl
  try {
    const pages = await getCdpJson('/json')
    const serverHost = new URL(state.config.serverUrl || DEFAULT_SERVER).hostname
    const page = pages.find((p) => {
      try { return new URL(p.url).hostname === serverHost } catch { return false }
    }) || pages.find((p) => p.webSocketDebuggerUrl)
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
  } catch {}
  if (!wsUrl) throw new Error('没有找到可读取的登录窗口，请先点击“打开登录窗口”。')

  let result
  try {
    result = await cdpCommand(wsUrl, 'Network.getAllCookies')
  } catch {
    result = await cdpCommand(wsUrl, 'Storage.getCookies')
  }
  const cookie = cookieHeaderFromCdpCookies(result.cookies || [], state.config.serverUrl || DEFAULT_SERVER)
  if (!cookie) {
    throw new Error('未读取到网站登录 Cookie。请确认专用 Edge 窗口已经登录成功，并且打开的是 b9b8b.vercel.app。')
  }
  state.config.cookie = cookie
  await saveState()
  log('已自动读取并保存登录授权。')
  return { cookieSaved: true }
}

function splitCookieHeader(cookie) {
  return String(cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
}

function splitSetCookieHeader(header) {
  const value = String(header || '')
  if (!value) return []
  const parts = []
  let start = 0
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== ',') continue
    const rest = value.slice(i + 1)
    if (/^\s*[^=;,\s]+=/.test(rest)) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

async function absorbResponseCookies(headersObj) {
  const rawCookies = typeof headersObj.getSetCookie === 'function'
    ? headersObj.getSetCookie()
    : splitSetCookieHeader(headersObj.get('set-cookie'))
  if (!rawCookies.length) return

  const jar = new Map()
  for (const part of splitCookieHeader(state.config.cookie)) {
    const eq = part.indexOf('=')
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1))
  }

  let changed = false
  for (const setCookie of rawCookies) {
    const first = setCookie.split(';')[0]?.trim()
    const eq = first?.indexOf('=')
    if (!first || eq <= 0) continue
    const name = first.slice(0, eq)
    const value = first.slice(eq + 1)
    if (!value) {
      changed = jar.delete(name) || changed
    } else if (jar.get(name) !== value) {
      jar.set(name, value)
      changed = true
    }
  }

  if (changed) {
    state.config.cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
    log('已自动更新服务器返回的 Cookie', 'info')
    await saveState()
  }
}

async function fetchJson(pathname, options = {}) {
  const { timeoutMs, ...requestOptions } = options
  const method = String(requestOptions.method || 'GET').toUpperCase()
  const maxAttempts = method === 'GET' ? 4 : 1
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchJsonOnce(pathname, requestOptions, timeoutMs)
    } catch (e) {
      lastError = e
      const retryable = method === 'GET' && !e.status
      if (!retryable || attempt >= maxAttempts) break
      const delay = Math.min(2000 * attempt, 8000)
      log(`网络请求失败，${delay / 1000}s 后重试 ${attempt}/${maxAttempts - 1}：${e.message}`, 'warn')
      await sleep(delay)
    }
  }
  throw lastError
}

async function fetchJsonOnce(pathname, options = {}, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(timeoutMs || state.config.requestTimeoutMs) || 600000)
  const target = apiUrl(pathname)
  const method = options.method || 'GET'
  try {
    const res = await fetch(target, {
      ...options,
      headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) },
      signal: controller.signal,
    })
    await absorbResponseCookies(res.headers)
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text }
    }
    if (!res.ok) {
      const msg = data?.message || data?.error || text || `HTTP ${res.status}`
      const err = new Error(msg)
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  } catch (e) {
    const reason = e?.cause?.message || e?.message || String(e)
    const isAuthExpired = e?.status === 401 && (reason === 'AUTH_001' || e?.data?.error === 'AUTH_001')
    const message = isAuthExpired
      ? `${method} ${target} 失败：登录 Cookie 已失效。请在 Edge 保持网站已登录，重新复制 Cookie 粘贴到本地工具后点击继续。`
      : `${method} ${target} 失败：${reason}`
    const err = new Error(message)
    err.status = e?.status
    err.data = e?.data
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function getProject() {
  const id = state.config.projectId
  const data = await fetchJson(`/api/projects/${id}`)
  return data.project
}

function getStep(project, type) {
  return (project.steps || []).find((s) => s.stepType === type)
}

async function postStep(type, body = {}) {
  const route = STEP_ROUTE[type]
  if (!route) throw new Error(`未配置步骤接口：${type}`)
  return fetchJson(`/api/projects/${state.config.projectId}/steps/${route}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function postStepLong(type, body = {}) {
  const route = STEP_ROUTE[type]
  if (!route) throw new Error(`未配置步骤接口：${type}`)
  return fetchJson(`/api/projects/${state.config.projectId}/steps/${route}`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: Math.max(Number(state.config.requestTimeoutMs) || 600000, 900000),
  })
}

function selectedAspectRatio() {
  return String(state.config.aspectRatio || '16:9').trim() || '16:9'
}

async function getStepApi(type) {
  const route = STEP_ROUTE[type]
  return fetchJson(`/api/projects/${state.config.projectId}/steps/${route}`)
}

function pause(reason) {
  state.runner.paused = true
  state.runner.waitingForManualContinue = true
  state.runner.pauseReason = reason
  setMessage(`已暂停：${reason}`)
}

function markStepDone(type) {
  state.runner.completedSteps[type] = true
}

function isServerStepDone(project, type) {
  const step = getStep(project, type)
  if (!step) return false
  if (type === 'STORYBOARD') {
    const output = step.outputData || {}
    const targets = listStoryboardTargets(output)
    if (targets.length > 0) {
      return targets.every((target) => target.done)
    }
    return step.status === 'COMPLETED'
  }
  if (type === 'VIDEO_DIRECT') {
    const output = step.outputData || {}
    const finalUrl = output.finalVideoUrl || output.videoUrl || output.composedVideoUrl
    if (finalUrl) return true
    return step.status === 'COMPLETED'
  }
  if (step.status === 'COMPLETED') return true
  const resultAssets = step.resultAssets || []
  return resultAssets.some((asset) => asset?.url)
}

function hasServerStepProgress(project, type) {
  const step = getStep(project, type)
  if (!step) return false
  if (isServerStepDone(project, type)) return true
  if (step.status === 'PROCESSING') return true
  const output = step.outputData || {}
  if (type === 'IDEATION') return (output.directions || []).length > 0
  if (type === 'FRAMEWORK') return Boolean(output.framework || output.title || output.synopsis)
  if (type === 'STYLE') return (output.styleOptions || []).some((s) => s.imageUrl || s.assetId)
  if (type === 'CHARACTER') return (output.portraits || []).length > 0 || (output.prompts || []).length > 0
  if (type === 'STORYBOARD') return (output.prompts || []).length > 0 || (output.shots || []).length > 0 || listStoryboardTargets(output).some((t) => t.done)
  if (type === 'VIDEO_DIRECT') {
    const clips = output.clips || output.videoClips || []
    return clips.length > 0 || (step.resultAssets || []).some((asset) => asset?.url)
  }
  return Boolean(Object.keys(output).length)
}

function inferLocalCompletedStepsFromServer(project) {
  const completedSteps = {}
  let furthestProgressIndex = -1
  for (const type of FLOW) {
    if (SKIPPED.has(type)) continue
    const index = FLOW.indexOf(type)
    if (hasServerStepProgress(project, type)) furthestProgressIndex = Math.max(furthestProgressIndex, index)
    if (isServerStepDone(project, type)) completedSteps[type] = true
  }
  for (let i = 0; i < furthestProgressIndex; i += 1) {
    const type = FLOW[i]
    if (!SKIPPED.has(type) && type !== 'STORYBOARD') completedSteps[type] = true
  }
  return completedSteps
}

async function syncLocalProgressFromServer(reason = '') {
  if (!state.config.projectId) return null
  const project = await getProject()
  const fresh = initialState()
  const skippedSteps = { ...fresh.runner.skippedSteps }
  for (const type of FLOW) {
    if (SKIPPED.has(type)) {
      skippedSteps[type] = true
    }
  }
  state.runner.completedSteps = inferLocalCompletedStepsFromServer(project)
  state.runner.skippedSteps = skippedSteps
  state.runner.currentStep = nextRunnableStep(project) || ''
  state.runner.lastError = ''
  state.runner.pauseReason = ''
  state.runner.waitingForManualContinue = false
  const doneCount = Object.keys(state.runner.completedSteps || {}).length
  const current = state.runner.currentStep ? (STEP_LABELS[state.runner.currentStep] || state.runner.currentStep) : '已完成'
  setMessage(`${reason || '已同步服务器进度'}：已完成 ${doneCount} 个执行步骤，当前位置：${current}`)
  return project
}

function isPausedOrStopped() {
  return !state.runner.running || state.runner.paused
}

async function waitForProjectStep(type, accept = (step) => step?.status === 'COMPLETED') {
  while (state.runner.running) {
    if (state.runner.paused) return false
    const project = await getProject()
    const step = getStep(project, type)
    if (step?.status === 'FAILED') {
      throw new Error(`${STEP_LABELS[type]}失败：${step.errorMessage || '未知错误'}`)
    }
    if (accept(step, project)) return true
    setMessage(`${STEP_LABELS[type]}处理中，当前状态：${step?.status || '未知'}`)
    await saveState()
    await sleep(Number(state.config.pollMs) || 15000)
  }
  return false
}

async function runIdeation(project) {
  const step = getStep(project, 'IDEATION')
  if (step?.status !== 'COMPLETED') {
    setMessage('启动创意扩散')
    await postStep('IDEATION', {})
    const ok = await waitForProjectStep('IDEATION')
    if (!ok) return
  }
  const fresh = await getProject()
  const ideation = getStep(fresh, 'IDEATION')
  const directions = ideation?.outputData?.directions || []
  if (state.config.directionIndex === null || state.config.directionIndex === undefined || state.config.directionIndex === '') {
    pause(`创意扩散已完成。请在本地控制台选择方向序号（0-${Math.max(0, directions.length - 1)}），或在服务器网页确认后填入序号，再点击继续。`)
    return
  }
  markStepDone('IDEATION')
  pause('创意扩散已完成，请确认后继续到框架搭建。')
}

async function runFramework(project) {
  const step = getStep(project, 'FRAMEWORK')
  if (step?.status !== 'COMPLETED') {
    const directionIndex = Number(state.config.directionIndex)
    if (!Number.isInteger(directionIndex) || directionIndex < 0) {
      pause('框架搭建需要先选择创意方向序号。')
      return
    }
    setMessage(`启动框架搭建，方向序号：${directionIndex}`)
    await postStep('FRAMEWORK', { directionIndex })
    const ok = await waitForProjectStep('FRAMEWORK')
    if (!ok) return
  }
  markStepDone('FRAMEWORK')
  pause('框架搭建已完成，请在服务器网页检查/编辑文本后点击继续。')
}

async function runStyle(project) {
  const step = getStep(project, 'STYLE')
  if (step?.status === 'COMPLETED') {
    markStepDone('STYLE')
    pause('风格统一已完成，请确认后继续。')
    return
  }

  const styleOutput = step?.outputData || {}
  const hasImages = (styleOutput.styleOptions || []).some((s) => s.imageUrl || s.assetId)
  if (!hasImages && step?.status !== 'PROCESSING') {
    setMessage('启动风格统一图片生成')
    await postStep('STYLE', { action: 'generate-images', aspectRatio: selectedAspectRatio() })
  }

  const ok = await waitForProjectStep('STYLE', (nextStep) => {
    if (nextStep?.status === 'COMPLETED') return true
    const out = nextStep?.outputData || {}
    return (out.styleOptions || []).some((s) => s.imageUrl || s.assetId)
  })
  if (!ok) return

  const fresh = await getProject()
  const freshStep = getStep(fresh, 'STYLE')
  if (freshStep?.status !== 'COMPLETED') {
    pause('风格图已生成。请在服务器网页选择一张风格图，保存后回到这里点击继续。')
    return
  }
  markStepDone('STYLE')
  pause('风格统一已完成，请确认后继续。')
}

async function runCharacter(project) {
  const step = getStep(project, 'CHARACTER')
  if (step?.status !== 'COMPLETED') {
    if (step?.status !== 'PROCESSING') {
      setMessage('启动人物设计生成')
      await postStep('CHARACTER', { action: 'generate-images', aspectRatio: selectedAspectRatio() })
    }
    const ok = await waitForProjectStep('CHARACTER')
    if (!ok) return
  }
  markStepDone('CHARACTER')
  pause('人物设计已完成，请确认后继续。')
}

function listStoryboardTargets(outputData) {
  const prompts = outputData?.prompts || []
  const assets = outputData?.shotAssets || []
  return prompts.map((p, index) => {
    const shotId = p.shotId || `shot_${String(index + 1).padStart(3, '0')}`
    const actNumber = Number(p.actNumber || 1)
    const done = assets.some((a) => a.shotId === shotId && Number(a.actNumber || 1) === actNumber)
    return { shotId, actNumber, done }
  })
}

function isRequestTimeoutError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('aborted') || message.includes('timeout') || message.includes('timed out')
}

function isAmbiguousNetworkClose(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return (
    message.includes('other side closed')
    || message.includes('socket disconnected')
    || message.includes('socket hang up')
    || message.includes('econnreset')
    || message.includes('terminated')
    || message.includes('fetch failed')
  )
}

function mayStillBeRunningAfterDisconnect(error) {
  if (!isRequestTimeoutError(error) && !isAmbiguousNetworkClose(error)) return false
  if (error?.status) return false
  return true
}

function isStoryboardTargetDone(outputData, target) {
  return listStoryboardTargets(outputData).some((t) => (
    t.shotId === target.shotId
    && Number(t.actNumber || 1) === Number(target.actNumber || 1)
    && t.done
  ))
}

async function waitForStoryboardTarget(target, maxMs = 300000) {
  const started = Date.now()
  while (state.runner.running && Date.now() - started < maxMs) {
    const fresh = await getProject()
    const step = getStep(fresh, 'STORYBOARD')
    const output = step?.outputData || {}
    if (isStoryboardTargetDone(output, target)) {
      await downloadAvailableResults(fresh)
      return true
    }
    const elapsedSeconds = Math.round((Date.now() - started) / 1000)
    setMessage(`等待分镜图片落库：第 ${target.actNumber} 幕 / ${target.shotId}，已等 ${elapsedSeconds}s`)
    await saveState()
    await sleep(Number(state.config.pollMs) || 15000)
  }
  return false
}

async function runStoryboard(project) {
  let step = getStep(project, 'STORYBOARD')
  let output = step?.outputData || {}
  if (!(output.prompts || []).length || !(output.shots || []).length) {
    setMessage('启动分镜文本生成')
    await postStep('STORYBOARD', { action: 'generate-prompts', mode: 'keyframe' })
    pause('分镜文本已生成。请在服务器网页检查/编辑分镜后点击继续，之后本地工具会逐镜头生成图片。')
    return
  }

  const targets = listStoryboardTargets(output)
  const next = targets.find((t) => !t.done)
  if (next) {
    setMessage(`生成分镜图片：第 ${next.actNumber} 幕 / ${next.shotId}`)
    try {
      await postStepLong('STORYBOARD', {
        action: 'generate-act-images',
        actNumber: next.actNumber,
        shotId: next.shotId,
        aspectRatio: selectedAspectRatio(),
        imageModel: 'gpt-image-2',
        noDedup: true,
      })
    } catch (e) {
      if (!mayStillBeRunningAfterDisconnect(e)) throw e
      setMessage(`分镜生成请求连接中断，先不重发，最多检查 5 分钟：第 ${next.actNumber} 幕 / ${next.shotId}`)
      const done = await waitForStoryboardTarget(next)
      if (!done) {
        throw new Error(`未检测到 ${next.shotId} 的分镜图落库。这次请求可能没有成功进入服务器生成，可点击“继续”安全重发该镜头。`)
      }
    }
    await downloadAvailableResults()
    await sleep(Number(state.config.itemDelayMs) || 5000)
    const fresh = await getProject()
    step = getStep(fresh, 'STORYBOARD')
    output = step?.outputData || {}
    const remaining = listStoryboardTargets(output).filter((t) => !t.done).length
    setMessage(`分镜图片已推进，剩余 ${remaining} 个镜头`)
    return
  }

  markStepDone('STORYBOARD')
  pause('分镜设计已完成，请确认后继续到直生视频。')
}

async function restartStoryboardImages() {
  const project = await getProject()
  const step = getStep(project, 'STORYBOARD')
  const output = step?.outputData || {}
  const prompts = output.prompts || []
  if (!prompts.length) throw new Error('当前项目还没有分镜提示词，请先生成分镜文本。')

  const actNumbers = [...new Set(prompts.map((p) => Number(p.actNumber || 1)).filter((n) => Number.isFinite(n)))]
  const firstAct = actNumbers.length ? Math.min(...actNumbers) : 1
  state.runner.completedSteps.STORYBOARD = false
  state.runner.running = false
  state.runner.paused = true
  state.runner.currentStep = 'STORYBOARD'
  state.runner.waitingForManualContinue = true
  setMessage(`重做分镜图片：清理第 ${firstAct} 幕旧图并重新生成第一张`)
  await postStep('STORYBOARD', {
    action: 'generate-act-images',
    actNumber: firstAct,
    force: true,
    aspectRatio: selectedAspectRatio(),
    imageModel: 'gpt-image-2',
  })
  await downloadAvailableResults()
  pause(`已开始重做第 ${firstAct} 幕分镜图片。请检查第一张新图，确认后点击继续逐镜头生成。`)
}

async function waitForVideoSegment(segmentId) {
  while (state.runner.running) {
    if (state.runner.paused) return false
    const data = await getStepApi('VIDEO_DIRECT')
    const seg = (data.videoSegments || []).find((s) => s.id === segmentId)
    if (!seg) throw new Error(`找不到视频片段：${segmentId}`)
    if (seg.status === 'completed') return true
    if (seg.status === 'failed') throw new Error(`视频片段失败：${seg.errorMessage || segmentId}`)
    setMessage(`视频片段生成中：${seg.shotId || segmentId}，状态 ${seg.status}`)
    await saveState()
    await sleep(Number(state.config.pollMs) || 15000)
  }
  return false
}

async function runVideoDirect(project) {
  let data = await getStepApi('VIDEO_DIRECT')
  if (!data.segmentPromptsGenerated || !(data.videoSegments || []).length) {
    setMessage('生成直生视频片段提示词')
    await postStep('VIDEO_DIRECT', { action: 'generate-segment-prompts' })
    pause('直生视频提示词已生成。请在服务器网页检查后点击继续，之后本地工具会逐段生成视频。')
    return
  }

  data = await getStepApi('VIDEO_DIRECT')
  const next = (data.videoSegments || []).find((s) => s.status !== 'completed')
  if (next) {
    setMessage(`启动直生视频片段：${next.shotId || next.id}`)
    await postStep('VIDEO_DIRECT', { action: 'generate-segment-video', segmentId: next.id, aspectRatio: selectedAspectRatio() })
    const ok = await waitForVideoSegment(next.id)
    if (!ok) return
    await downloadAvailableResults()
    await sleep(Number(state.config.itemDelayMs) || 5000)
    return
  }

  const step = getStep(project, 'VIDEO_DIRECT')
  if (step?.status !== 'COMPLETED') {
    setMessage('所有直生视频片段已完成，启动合成')
    try {
      await postStep('VIDEO_DIRECT', { action: 'compose-video', aspectRatio: selectedAspectRatio() })
    } catch (e) {
      setError(`合成请求失败：${e.message}`)
    }
  }
  markStepDone('VIDEO_DIRECT')
  pause('直生视频片段已全部完成。请在服务器网页确认合成结果。')
}

async function runStep(type, project) {
  state.runner.currentStep = type
  if (SKIPPED.has(type)) {
    state.runner.skippedSteps[type] = true
    setMessage(`跳过步骤：${STEP_LABELS[type]}`)
    return
  }
  if (type === 'IDEATION') return runIdeation(project)
  if (type === 'FRAMEWORK') return runFramework(project)
  if (type === 'STYLE') return runStyle(project)
  if (type === 'CHARACTER') return runCharacter(project)
  if (type === 'STORYBOARD') return runStoryboard(project)
  if (type === 'VIDEO_DIRECT') return runVideoDirect(project)
}

function nextRunnableStep(project) {
  state.runner.completedSteps = inferLocalCompletedStepsFromServer(project)
  for (const type of FLOW) {
    if (SKIPPED.has(type)) continue
    if (state.runner.completedSteps[type]) continue
    const step = getStep(project, type)
    if (type === 'STYLE' && step?.status !== 'COMPLETED') return type
    if (type === 'STORYBOARD') {
      const output = step?.outputData || {}
      const hasPendingImages = listStoryboardTargets(output).some((t) => !t.done)
      if (step?.status !== 'COMPLETED' || hasPendingImages) return type
      return type
    }
    if (type === 'VIDEO_DIRECT') return type
    if (step?.status !== 'COMPLETED') return type
    return type
  }
  return ''
}

async function runnerLoop(epoch = runnerEpoch) {
  if (loopActive && activeLoopEpoch === epoch) return
  loopActive = true
  activeLoopEpoch = epoch
  try {
    while (state.runner.running && epoch === runnerEpoch) {
      if (state.runner.paused) {
        await saveState()
        await sleep(1000)
        continue
      }
      try {
        const project = await getProject()
        if (epoch !== runnerEpoch) break
        await downloadAvailableResults(project).catch((e) => setError(`下载检查失败：${e.message}`))
        if (epoch !== runnerEpoch) break
        const next = nextRunnableStep(project)
        if (!next) {
          state.runner.running = false
          setMessage('流程已完成')
          await saveState()
          break
        }
        await runStep(next, project)
        if (epoch !== runnerEpoch) break
        await saveState()
        await sleep(1000)
      } catch (e) {
        if (epoch !== runnerEpoch) break
        state.runner.paused = true
        state.runner.waitingForManualContinue = true
        setError(e.message || String(e))
        await saveState()
      }
    }
  } finally {
    if (activeLoopEpoch === epoch) {
      loopActive = false
      activeLoopEpoch = 0
    }
  }
}

function safeName(input) {
  return String(input || 'unnamed')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'unnamed'
}

function extFromUrl(url, fallback = '') {
  try {
    const u = new URL(url, state.config.serverUrl)
    const ext = path.extname(u.pathname)
    return ext || fallback
  } catch {
    return fallback
  }
}

async function downloadFile(url, filePath) {
  const absolute = new URL(url, state.config.serverUrl).toString()
  const res = await fetch(absolute, { headers: headers(false) })
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${absolute}`)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const buf = Buffer.from(await res.arrayBuffer())
  await fsp.writeFile(filePath, buf)
}

function addDownloadCandidate(items, key, stepType, type, url, filename) {
  if (!url) return
  items.push({ key, stepType, type, url, filename })
}

async function collectDownloadItems(project) {
  const fresh = project || await getProject()
  const items = []
  for (const step of fresh.steps || []) {
    for (const asset of step.resultAssets || []) {
      addDownloadCandidate(
        items,
        `asset:${asset.id}`,
        step.stepType,
        asset.type,
        asset.url,
        `${STEP_LABELS[step.stepType] || step.stepType}_${asset.id}${extFromUrl(asset.url, asset.type === 'VIDEO' ? '.mp4' : '.png')}`
      )
    }
  }

  for (const type of ['STYLE', 'CHARACTER', 'STORYBOARD']) {
    try {
      const data = await getStepApi(type)
      for (const asset of data.assets || []) {
        addDownloadCandidate(
          items,
          `asset:${asset.id}`,
          type,
          asset.type,
          asset.url,
          `${STEP_LABELS[type]}_${asset.id}${extFromUrl(asset.url, asset.type === 'VIDEO' ? '.mp4' : '.png')}`
        )
      }
      const shotAssets = data.outputData?.shotAssets || []
      for (const shot of shotAssets) {
        addDownloadCandidate(
          items,
          `storyboard:${shot.assetId || shot.shotId}`,
          'STORYBOARD',
          'IMAGE',
          shot.url,
          `分镜设计_${shot.actNumber || 1}_${shot.shotId || 'shot'}${extFromUrl(shot.url, '.png')}`
        )
      }
    } catch {
      // Some step GET routes are unavailable until the workflow reaches them.
    }
  }

  try {
    const direct = await getStepApi('VIDEO_DIRECT')
    for (const seg of direct.videoSegments || []) {
      addDownloadCandidate(
        items,
        `videoSegment:${seg.id}`,
        'VIDEO_DIRECT',
        'VIDEO',
        seg.videoUrl,
        `直生视频_${String(seg.sequence + 1).padStart(3, '0')}_${seg.shotId || seg.id}${extFromUrl(seg.videoUrl, '.mp4')}`
      )
    }
    for (const clip of direct.clips || []) {
      addDownloadCandidate(
        items,
        `directClip:${clip.shotId}:${clip.url}`,
        'VIDEO_DIRECT',
        'VIDEO',
        clip.url,
        `直生视频_${clip.shotId || 'clip'}${extFromUrl(clip.url, '.mp4')}`
      )
    }
  } catch {
    // ignore
  }
  return { project: fresh, items }
}

async function downloadAvailableResults(project) {
  const { project: fresh, items } = await collectDownloadItems(project)
  const projectDir = path.join(state.config.saveDir, safeName(fresh.title || fresh.id))
  for (const item of items) {
    if (state.downloads.downloaded[item.key]) continue
    const stepDir = path.join(projectDir, `${FLOW.indexOf(item.stepType) + 1}-${STEP_LABELS[item.stepType] || item.stepType}`)
    const filePath = path.join(stepDir, safeName(item.filename))
    try {
      await downloadFile(item.url, filePath)
      state.downloads.downloaded[item.key] = { ...item, filePath, downloadedAt: new Date().toISOString() }
      state.downloads.items.unshift({ ...item, filePath, downloadedAt: new Date().toISOString() })
      state.downloads.items = state.downloads.items.slice(0, 300)
      log(`已下载：${filePath}`)
    } catch (e) {
      log(`下载失败：${item.filename}，${e.message}`, 'warn')
    }
  }
}

function htmlPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI影视本地顺序生成助手</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;background:#f6f5f3;color:#292524}
    .wrap{max-width:1180px;margin:0 auto;padding:24px}
    h1{font-size:24px;margin:0 0 16px}
    .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}
    .card{background:#fff;border:1px solid #e7e5e4;border-radius:8px;padding:16px;box-shadow:0 1px 2px #00000008}
    label{display:block;font-size:12px;color:#78716c;margin:10px 0 5px}
    input,textarea,select{width:100%;box-sizing:border-box;border:1px solid #d6d3d1;border-radius:7px;padding:9px 10px;font:inherit;background:#fff}
    textarea{min-height:84px;resize:vertical}
    button{border:0;border-radius:7px;padding:9px 13px;font-weight:650;cursor:pointer}
    .primary{background:#1c1917;color:#fff}.secondary{background:#eeeae6;color:#292524}.danger{background:#ef4444;color:#fff}
    .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .muted{color:#78716c;font-size:12px}.status{font-size:15px;line-height:1.6}.pill{display:inline-flex;border-radius:999px;padding:3px 8px;background:#f5f5f4;font-size:12px;margin:2px}
    .done{background:#dcfce7;color:#166534}.skip{background:#fef3c7;color:#92400e}.current{background:#dbeafe;color:#1d4ed8}.fail{background:#fee2e2;color:#991b1b}
    pre{white-space:pre-wrap;background:#1c1917;color:#f5f5f4;border-radius:8px;padding:12px;max-height:360px;overflow:auto;font-size:12px}
    .downloads{max-height:240px;overflow:auto;font-size:12px}
    a{color:#2563eb}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>AI影视本地顺序生成助手</h1>
    <div class="grid">
      <div class="card">
        <h2>连接配置</h2>
        <label>服务器地址</label>
        <input id="serverUrl" placeholder="https://b9b8b.vercel.app" />
        <label>项目链接或项目 ID</label>
        <input id="projectUrl" placeholder="https://b9b8b.vercel.app/project/xxx/workflow" />
        <label>Cookie（从已登录浏览器复制，保存在本机 .local-runner，不会提交到仓库）</label>
        <textarea id="cookie" placeholder="粘贴 Cookie 请求头，例如 sb-...=...; ..."></textarea>
        <div class="card" style="margin-top:12px;background:#fafaf9">
          <h3 style="margin:0 0 8px">第 1 步：登录授权（推荐）</h3>
          <p class="muted">不用找 Cookie。先点击“打开登录窗口”，在弹出的 Edge 窗口登录网站；登录完成后回到这里点击“我已登录，自动授权”。</p>
          <div class="row">
            <button class="secondary" onclick="openAuthBrowser()">打开登录窗口</button>
            <button class="primary" onclick="captureAuth()">我已登录，自动授权</button>
            <button class="secondary" onclick="checkLogin()">检测登录是否可用</button>
          </div>
        </div>
        <label>本地保存目录</label>
        <input id="saveDir" />
        <div class="row">
          <div style="flex:1">
            <label>轮询间隔 ms</label>
            <input id="pollMs" type="number" />
          </div>
          <div style="flex:1">
            <label>逐项间隔 ms</label>
            <input id="itemDelayMs" type="number" />
          </div>
          <div style="flex:1">
            <label>请求超时 ms</label>
            <input id="requestTimeoutMs" type="number" />
          </div>
          <div style="width:160px">
            <label>生成长宽比</label>
            <select id="aspectRatio">
              <option value="16:9">16:9 横屏</option>
              <option value="9:16">9:16 竖屏</option>
              <option value="1:1">1:1 方图</option>
              <option value="4:3">4:3 横屏</option>
              <option value="3:4">3:4 竖屏</option>
              <option value="21:9">21:9 宽屏</option>
            </select>
          </div>
          <div style="width:160px">
            <label>创意方向序号</label>
            <input id="directionIndex" type="number" min="0" placeholder="0" />
          </div>
        </div>
        <p class="muted">流程默认跳过：概念图、宣传片、生成尾帧。每一步完成后必须手动点击继续。</p>
        <div class="row" style="margin-top:14px">
          <button class="secondary" onclick="saveConfig()">保存配置</button>
          <button class="secondary" onclick="syncProgress()">同步服务器进度</button>
          <button class="primary" onclick="start()">开始</button>
          <button class="primary" onclick="cont()">继续</button>
          <button class="secondary" onclick="pause()">暂停</button>
          <button class="danger" onclick="stop()">停止</button>
          <button class="secondary" onclick="downloadNow()">立即下载结果</button>
          <button class="secondary" onclick="resetLocalProgressAction()">重置本地进度</button>
          <button class="secondary" onclick="restartStoryboard()">重做分镜图片</button>
        </div>
      </div>
      <div class="card">
        <h2>状态</h2>
        <div id="status" class="status">加载中...</div>
        <h3>步骤</h3>
        <div id="steps"></div>
      </div>
    </div>
    <div class="grid" style="margin-top:16px">
      <div class="card">
        <h2>日志</h2>
        <pre id="logs"></pre>
      </div>
      <div class="card">
        <h2>下载记录</h2>
        <div id="downloads" class="downloads"></div>
      </div>
    </div>
  </div>
<script>
const $ = (id) => document.getElementById(id)
async function api(path, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  const res = await fetch(path, {method: body ? 'POST' : 'GET', headers:{'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined, signal: controller.signal}).finally(() => clearTimeout(timer))
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || data.message || res.status)
  return data
}
function formConfig() {
  const data = {
    serverUrl: $('serverUrl').value,
    projectUrl: $('projectUrl').value,
    saveDir: $('saveDir').value,
    pollMs: Number($('pollMs').value || 15000),
    itemDelayMs: Number($('itemDelayMs').value || 5000),
    requestTimeoutMs: Number($('requestTimeoutMs').value || 600000),
    aspectRatio: $('aspectRatio').value || '16:9',
    directionIndex: $('directionIndex').value === '' ? null : Number($('directionIndex').value),
  }
  if ($('cookie').value.trim()) data.cookie = $('cookie').value.trim()
  return data
}
async function runAction(fn) {
  try { await fn() } catch (e) { alert(e.message || String(e)); await refresh().catch(() => {}) }
}
async function saveConfig(){ await runAction(async () => { await api('/api/config', formConfig()); await refresh() }) }
async function openAuthBrowser(){ await runAction(async () => { await api('/api/config', formConfig()); await api('/api/auth/open', {}); await refresh(); alert('已打开专用 Edge 登录窗口。请在该窗口登录网站，登录完成后回到本工具点击“我已登录，自动授权”。') }) }
async function captureAuth(){ await runAction(async () => { await api('/api/config', formConfig()); await api('/api/auth/capture', {}); $('cookie').value = ''; await refresh(); alert('授权成功。现在可以填写项目链接并点击“开始”。') }) }
async function checkLogin(){ await runAction(async () => { await api('/api/config', formConfig()); await api('/api/check'); alert('登录可用，可以开始执行。'); await refresh() }) }
async function syncProgress(){ await runAction(async () => { await api('/api/config', formConfig()); await api('/api/sync-progress', {}); await refresh() }) }
async function start(){ await runAction(async () => { await api('/api/config', formConfig()); await api('/api/start', {}); await refresh() }) }
async function cont(){ await runAction(async () => { await api('/api/config', formConfig()); await api('/api/continue', {}); await refresh() }) }
async function pause(){ await runAction(async () => { await api('/api/pause', {}); await refresh() }) }
async function stop(){ await runAction(async () => { await api('/api/stop', {}); await refresh() }) }
async function downloadNow(){ await runAction(async () => { await api('/api/config', formConfig()); await api('/api/download', {}); await refresh() }) }
async function resetLocalProgressAction(){ if (!confirm('只会清空本地工具的执行进度和下载记录，不会删除服务器结果，也不会扣点。继续吗？')) return; await runAction(async () => { await api('/api/config', formConfig()); await api('/api/reset-local-progress', {}); await refresh() }) }
async function restartStoryboard(){ if (!confirm('会清理服务器上当前第一幕已有分镜图，并重新生成第一张，可能扣除一次分镜生图点数。继续吗？')) return; await runAction(async () => { await api('/api/config', formConfig()); await api('/api/storyboard/restart-images', {}); await refresh() }) }
function stepClass(type, s) {
  if (s.runner.currentStep === type) return 'pill current'
  if (s.runner.completedSteps[type]) return 'pill done'
  if (s.runner.skippedSteps[type]) return 'pill skip'
  return 'pill'
}
async function refresh() {
  const s = await api('/api/state')
  for (const [k,v] of Object.entries(s.config)) {
    if (k === 'cookie' || k === 'cookieSaved') continue
    if ($(k) && document.activeElement !== $(k)) $(k).value = v ?? ''
  }
  if (s.config.cookieSaved && !$('cookie').value && document.activeElement !== $('cookie')) $('cookie').placeholder = '已保存 Cookie；如需更换请重新粘贴'
  $('status').innerHTML = [
    '<b>' + (s.runner.running ? '运行中' : '未运行') + '</b>' + (s.runner.paused ? ' / 已暂停' : ''),
    '当前步骤：' + (s.runner.currentStep || '-'),
    '消息：' + (s.runner.lastMessage || '-'),
    s.runner.pauseReason ? '等待：' + s.runner.pauseReason : '',
    s.runner.lastError ? '<span style="color:#b91c1c">错误：' + s.runner.lastError + '</span>' : ''
  ].filter(Boolean).join('<br/>')
  const labels = ${JSON.stringify(STEP_LABELS)}
  const flow = ${JSON.stringify(FLOW)}
  $('steps').innerHTML = flow.map(t => '<span class="' + stepClass(t,s) + '">' + labels[t] + '</span>').join('')
  $('logs').textContent = (s.logs || []).map(l => '[' + l.time + '] ' + l.level + ' ' + l.message).join('\\n')
  $('downloads').innerHTML = (s.downloads.items || []).map(d => '<div><b>' + d.stepType + '</b> ' + d.filePath + '</div>').join('') || '<span class="muted">暂无</span>'
}
setInterval(refresh, 2000)
refresh()
</script>
</body>
</html>`
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function clientState() {
  return {
    ...state,
    config: {
      ...state.config,
      cookie: '',
      cookieSaved: Boolean(state.config.cookie),
    },
  }
}

function scheduleRunnerLoop() {
  const epoch = runnerEpoch
  setImmediate(() => {
    runnerLoop(epoch).catch((e) => {
      setError(e.message || String(e))
      state.runner.paused = true
      state.runner.waitingForManualContinue = true
      saveState().catch(() => {})
    })
  })
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, clientState())
    if (req.method === 'POST' && url.pathname === '/api/auth/open') {
      const result = await launchAuthBrowser()
      await saveState()
      return sendJson(res, 200, { ok: true, ...result })
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/capture') {
      const result = await captureAuthCookies()
      return sendJson(res, 200, { ok: true, ...result })
    }
    if (req.method === 'GET' && url.pathname === '/api/check') {
      if (!state.config.projectId) throw new Error('缺少项目链接或项目 ID')
      if (!state.config.cookie) throw new Error('缺少 Cookie，无法以登录身份调用服务器')
      const project = await getProject()
      return sendJson(res, 200, {
        ok: true,
        project: {
          id: project.id,
          title: project.title,
          steps: (project.steps || []).map((step) => ({
            stepType: step.stepType,
            status: step.status,
          })),
        },
      })
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await readBody(req)
      const previousProjectId = state.config.projectId
      const nextProjectUrl = body.projectUrl || state.config.projectUrl
      const nextProjectId = parseProjectId(body.projectUrl || body.projectId || state.config.projectUrl || state.config.projectId)
      const projectChanged = Boolean(nextProjectId && previousProjectId !== nextProjectId)
      state.config = {
        ...state.config,
        ...body,
        cookie: typeof body.cookie === 'string' && body.cookie.trim() ? body.cookie.trim() : state.config.cookie,
        serverUrl: normalizeServerUrl(body.serverUrl),
        projectUrl: nextProjectUrl,
        projectId: nextProjectId,
      }
      if (projectChanged) {
        resetLocalProgress(`已切换项目：${previousProjectId} -> ${nextProjectId}，本地进度和下载记录已重置`, {
          clearDirectionIndex: true,
        })
        if (state.config.cookie) {
          await syncLocalProgressFromServer('已切换项目并同步服务器进度')
        }
      } else {
        state.runner.lastError = ''
      }
      await saveState()
      return sendJson(res, 200, clientState())
    }
    if (req.method === 'POST' && url.pathname === '/api/sync-progress') {
      if (!state.config.projectId) throw new Error('缺少项目链接或项目 ID')
      if (!state.config.cookie) throw new Error('缺少 Cookie，无法以登录身份调用服务器')
      await syncLocalProgressFromServer('已手动同步服务器进度')
      await saveState()
      return sendJson(res, 200, clientState())
    }
    if (req.method === 'POST' && url.pathname === '/api/reset-local-progress') {
      resetLocalProgress(`已重置当前项目本地进度：${state.config.projectId || '未选择项目'}`, {
        clearDirectionIndex: true,
      })
      await saveState()
      return sendJson(res, 200, clientState())
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      if (!state.config.projectId) throw new Error('缺少项目链接或项目 ID')
      if (!state.config.cookie) throw new Error('缺少 Cookie，无法以登录身份调用服务器')
      await syncLocalProgressFromServer('启动前已同步服务器进度')
      state.runner.running = true
      state.runner.paused = false
      state.runner.waitingForManualContinue = false
      state.runner.pauseReason = ''
      state.runner.lastError = ''
      state.runner.startedAt = state.runner.startedAt || new Date().toISOString()
      setMessage('本地 runner 已启动')
      await saveState()
      scheduleRunnerLoop()
      return sendJson(res, 200, clientState())
    }
    if (req.method === 'POST' && url.pathname === '/api/continue') {
      if (!state.config.projectId) throw new Error('缺少项目链接或项目 ID')
      if (!state.config.cookie) throw new Error('缺少 Cookie，无法以登录身份调用服务器')
      await syncLocalProgressFromServer('继续前已同步服务器进度')
      state.runner.running = true
      state.runner.paused = false
      state.runner.waitingForManualContinue = false
      state.runner.pauseReason = ''
      state.runner.lastError = ''
      setMessage('继续执行')
      await saveState()
      scheduleRunnerLoop()
      return sendJson(res, 200, clientState())
    }
    if (req.method === 'POST' && url.pathname === '/api/pause') {
      state.runner.paused = true
      state.runner.pauseReason = '用户手动暂停'
      setMessage('已暂停')
      await saveState()
      return sendJson(res, 200, clientState())
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      state.runner.running = false
      state.runner.paused = false
      state.runner.waitingForManualContinue = false
      state.runner.pauseReason = ''
      state.runner.currentStep = ''
      setMessage('已停止')
      await saveState()
      return sendJson(res, 200, clientState())
    }
    if (req.method === 'POST' && url.pathname === '/api/download') {
      await downloadAvailableResults()
      await saveState()
      return sendJson(res, 200, clientState())
    }
    if (req.method === 'POST' && url.pathname === '/api/storyboard/restart-images') {
      await restartStoryboardImages()
      await saveState()
      return sendJson(res, 200, clientState())
    }
    return sendJson(res, 404, { error: 'not found' })
  } catch (e) {
    setError(e.message || String(e))
    await saveState().catch(() => {})
    return sendJson(res, 500, { error: e.message || String(e) })
  }
}

async function main() {
  await loadState()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(htmlPage())
  })
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用。本地工具可能已经在运行，请直接打开：http://localhost:${PORT}`)
      console.error(`如需重启，请先关闭旧的本地工具终端，或结束占用 ${PORT} 端口的 node 进程。`)
      process.exit(1)
    }
    throw e
  })
  server.listen(PORT, () => {
    console.log(`AI影视本地顺序生成助手已启动：http://localhost:${PORT}`)
    console.log('关闭这个终端窗口会停止本地助手；服务器上的已启动任务不会被取消。')
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
