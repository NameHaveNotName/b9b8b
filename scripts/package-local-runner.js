/* eslint-disable no-console */
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const DIST_ROOT = path.join(ROOT, 'output', 'local-runner-release')
const APP_NAME = 'AI影视本地顺序生成助手'
const APP_DIR = path.join(DIST_ROOT, APP_NAME)

async function copyFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.copyFile(src, dest)
}

function toCrlf(content) {
  return content.replace(/\r?\n/g, '\r\n')
}

async function writeText(file, content, options = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const normalized = toCrlf(content)
  if (options.encoding === 'ascii') {
    await fsp.writeFile(file, Buffer.from(normalized, 'ascii'))
    return
  }
  if (options.bom) {
    await fsp.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(normalized, 'utf8')]))
    return
  }
  await fsp.writeFile(file, normalized, 'utf8')
}

async function main() {
  await fsp.rm(DIST_ROOT, { recursive: true, force: true })
  await fsp.mkdir(APP_DIR, { recursive: true })

  await copyFile(
    path.join(ROOT, 'tools', 'local-runner', 'launch.js'),
    path.join(APP_DIR, 'tools', 'local-runner', 'launch.js')
  )
  await copyFile(
    path.join(ROOT, 'tools', 'local-runner', 'server.js'),
    path.join(APP_DIR, 'tools', 'local-runner', 'server.js')
  )
  if (process.platform === 'win32' && fs.existsSync(process.execPath)) {
    await copyFile(process.execPath, path.join(APP_DIR, 'runtime', 'node.exe'))
  }

  const cmdLauncher = `@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 (
  echo.
  echo Local runner failed to start.
  echo Please send this window screenshot to support.
  echo.
  pause
  exit /b 1
)
`

  await writeText(path.join(APP_DIR, '启动.bat'), cmdLauncher, { encoding: 'ascii' })
  await writeText(path.join(APP_DIR, 'start.cmd'), cmdLauncher, { encoding: 'ascii' })

  await writeText(path.join(APP_DIR, 'launch.ps1'), `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Set-Location -LiteralPath $PSScriptRoot

$nodeExe = Join-Path $PSScriptRoot 'runtime\\node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    Write-Host ''
    Write-Host '没有检测到内置 Node.js，也没有检测到系统 Node.js，工具无法启动。'
    Write-Host '请联系管理员重新发送完整压缩包，或安装 Node.js LTS 后重试。'
    Write-Host ''
    Read-Host '按回车键退出'
    exit 1
  }
  $nodeExe = $nodeCommand.Source
}

Write-Host '正在启动 AI影视本地顺序生成助手...'
Write-Host '启动成功后会自动打开浏览器页面。'
Write-Host ''

& $nodeExe (Join-Path $PSScriptRoot 'tools\\local-runner\\launch.js')
$exitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }
if ($exitCode -ne 0) {
  Write-Host ''
  Write-Host "工具启动失败，退出代码：$exitCode"
  Write-Host '请把这个窗口截图发给管理员。'
  Write-Host ''
  Read-Host '按回车键退出'
}
exit $exitCode
`, { bom: true })

  await writeText(path.join(APP_DIR, '使用说明.txt'), `AI影视本地顺序生成助手 - 用户使用说明

一、这个工具是做什么的

它会在你的电脑上长期运行，自动帮你按顺序推进线上项目生成。
扣点、账号权限、实际生成仍然全部走线上网站；本地工具只负责自动点击、等待、轮询和下载结果。

二、第一次使用

1. 解压这个压缩包。
2. 双击“启动.bat”。
3. 启动成功后，会自动打开本地工具页面。

正常情况下不需要安装任何命令行工具，压缩包里已经带了运行环境。

如果双击“启动.bat”后出现“不是内部或外部命令”等黑窗报错：
1. 关闭黑窗。
2. 双击同一文件夹里的“start.cmd”。
3. 如果仍然失败，把黑窗截图发给管理员。

注意：不要直接在压缩包预览窗口里打开。必须先完整解压整个文件夹，再双击启动文件。

三、登录授权（不需要找 Cookie）

1. 在本地工具页面里，点击“打开登录窗口”。
2. 系统会弹出一个专用 Edge 窗口。
3. 在这个 Edge 窗口里登录网站账号。
4. 登录成功后，回到本地工具页面。
5. 点击“我已登录，自动授权”。
6. 再点击“检测登录是否可用”。

如果检测成功，就说明授权完成。

四、填写项目

1. 打开线上网站里的项目工作流页面。
2. 复制浏览器地址栏里的项目链接。
   示例：
   https://b9b8b.vercel.app/project/xxxx/workflow
3. 粘贴到本地工具的“项目链接或项目 ID”输入框。
4. 选择生成长宽比，例如：
   - 16:9 横屏
   - 9:16 竖屏
   - 1:1 方图
5. 点击“保存配置”。
6. 点击“同步服务器进度”。
7. 点击“开始”。

五、运行过程中

每个大步骤完成后，工具会暂停。
你需要去线上网页检查内容，确认没问题后，回到本地工具点击“继续”。

如果你换了新项目：
1. 粘贴新项目链接。
2. 点击“保存配置”。
3. 点击“同步服务器进度”。
4. 再点击“开始”。

六、生成结果保存在哪里

默认保存到：
Windows 下载目录\\AI影视生成结果

你也可以在本地工具页面里修改“本地保存目录”。

七、常见问题

1. 双击后闪退
   请先确认已经完整解压，不是在压缩包里直接打开。
   如果仍失败，双击“start.cmd”再试。

2. 检测登录失败
   先确认你是在“打开登录窗口”弹出的专用 Edge 窗口里登录的。
   登录后不要关闭这个窗口，回到本地工具点击“我已登录，自动授权”。

3. 提示端口 4317 被占用
   说明工具可能已经打开了。直接访问：
   http://localhost:4317

4. 网络连接失败
   如果你的浏览器使用代理，工具会自动读取 Windows 系统代理。
   如果仍失败，先确认线上网站能正常打开。

5. 不要把整个文件夹发给陌生人看
   工具会在本机保存登录授权信息。你自己使用没问题，但不要把已经运行过的工具文件夹再次转发给别人。

6. 黑窗提示“不是内部或外部命令”
   这是 Windows 对中文批处理编码不兼容导致的。新版工具已经提供了备用入口“start.cmd”。
   如果你看到这个报错，关闭窗口后双击“start.cmd”。

八、给管理员的话

用户只需要：
1. 解压
2. 双击“启动.bat”
3. 点击“打开登录窗口”
4. 登录
5. 点击“我已登录，自动授权”
6. 粘贴项目链接
7. 点击“开始/继续”
`)

  const zipPath = path.join(DIST_ROOT, `${APP_NAME}.zip`)
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath '${APP_DIR.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ], { stdio: 'inherit' })
  } else {
    execFileSync('zip', ['-r', zipPath, APP_NAME], { cwd: DIST_ROOT, stdio: 'inherit' })
  }

  console.log(`已生成：${zipPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
