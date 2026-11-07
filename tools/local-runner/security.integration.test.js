const assert = require('assert/strict')
const fs = require('fs/promises')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

async function rawRequest(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

async function waitForStart(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('runner did not start')), 10000)
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('已启动')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`runner exited early: ${code}`))
    })
  })
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-runner-security-'))
  const port = 44000 + Math.floor(Math.random() * 1000)
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      LOCAL_RUNNER_PORT: String(port),
      LOCAL_RUNNER_STATE_DIR: tempDir,
      LOCAL_RUNNER_ALLOWED_ORIGINS: 'https://staging.example',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForStart(child)
    const page = await rawRequest(port, { headers: { Host: `127.0.0.1:${port}` } })
    assert.equal(page.status, 200)
    const token = page.body.match(/const CONTROL_TOKEN = "([^"]+)"/)?.[1]
    assert.ok(token && token.length >= 40, 'page should receive a high-entropy control token')

    const baseHeaders = {
      Host: `127.0.0.1:${port}`,
      Origin: `http://127.0.0.1:${port}`,
      'X-Local-Runner-Token': token,
    }
    assert.equal((await rawRequest(port, { path: '/api/state', headers: baseHeaders })).status, 200)
    assert.equal((await rawRequest(port, { path: '/api/state', headers: { Host: `127.0.0.1:${port}` } })).status, 401)
    assert.equal((await rawRequest(port, { path: '/api/state', headers: { ...baseHeaders, Origin: 'https://evil.example' } })).status, 403)
    assert.equal((await rawRequest(port, { path: '/api/state', headers: { ...baseHeaders, Host: 'evil.example' } })).status, 400)
    assert.equal((await rawRequest(port, {
      path: '/api/config', method: 'POST', headers: { ...baseHeaders, 'Content-Type': 'text/plain' }, body: '{}',
    })).status, 415)

    const postConfig = (body) => rawRequest(port, {
      path: '/api/config',
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert.equal((await postConfig({ cookie: 'private-session=value' })).status, 200)
    const diskState = JSON.parse(await fs.readFile(path.join(tempDir, 'state.json'), 'utf8'))
    assert.equal(diskState.config.cookie, '', 'ordinary state file must not contain the cookie')
    assert.equal(await fs.readFile(path.join(tempDir, 'session-cookie.secret'), 'utf8'), 'private-session=value')

    assert.equal((await postConfig({ serverUrl: 'https://staging.example' })).status, 200)
    const changed = JSON.parse((await rawRequest(port, { path: '/api/state', headers: baseHeaders })).body)
    assert.equal(changed.config.cookieSaved, false, 'changing origin must clear the old cookie')
    await assert.rejects(fs.readFile(path.join(tempDir, 'session-cookie.secret'), 'utf8'), /ENOENT/)

    assert.notEqual((await postConfig({ serverUrl: 'https://evil.example' })).status, 200)
    console.log('local-runner integration security tests passed')
  } finally {
    child.kill()
    await new Promise((resolve) => child.once('exit', resolve))
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
