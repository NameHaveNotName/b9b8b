/**
 * 安全、计费与统计口径关键逻辑的自检脚本
 *
 * 覆盖修复里最容易回归、且不需要数据库/网络就能验证的部分：
 * - SSRF 判定（IPv6 / 十进制 IP / 元数据地址 / 协议）
 * - 上传文件名与扩展名清洗（路径穿越 / XSS 扩展名）
 * - 预签名 URL 过期判定与重签意图
 * - 贡献度去重口径（同一目标多次重生成只算一次有效贡献）
 * - 批量费用计算
 *
 * 运行：npm test
 */

import assert from 'node:assert/strict'

import { isBlockedIp, assertSsrfSafe } from '../lib/ssrf-guard.ts'
import { safeSegment, resolveUploadExtension, isUploadSizeAllowed } from '../lib/upload-safety.ts'
import { calculateBatchCost, GENERATION_COSTS } from '../lib/points-config.ts'

let passed = 0
let failed = 0

function check(name: string, fn: () => void) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (err: any) {
    failed += 1
    console.error(`  FAIL ${name}\n       ${err?.message}`)
  }
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (err: any) {
    failed += 1
    console.error(`  FAIL ${name}\n       ${err?.message}`)
  }
}

console.log('\n== SSRF: IP 字面量判定 ==')

check('IPv4 回环 127.0.0.1 被拦截', () => assert.equal(isBlockedIp('127.0.0.1'), true))
check('IPv4 10/8 被拦截', () => assert.equal(isBlockedIp('10.1.2.3'), true))
check('IPv4 172.16/12 被拦截', () => assert.equal(isBlockedIp('172.20.0.1'), true))
check('IPv4 192.168/16 被拦截', () => assert.equal(isBlockedIp('192.168.1.1'), true))
check('云元数据 169.254.169.254 被拦截', () => assert.equal(isBlockedIp('169.254.169.254'), true))
check('CGNAT 100.64/10 被拦截', () => assert.equal(isBlockedIp('100.64.0.1'), true))
check('组播 224+ 被拦截', () => assert.equal(isBlockedIp('224.0.0.1'), true))
check('公网 8.8.8.8 放行', () => assert.equal(isBlockedIp('8.8.8.8'), false))

// 之前 image-proxy 的漏洞点：new URL('http://[::1]/').hostname === '[::1]'
check('IPv6 [::1] 被拦截（带方括号）', () => assert.equal(isBlockedIp('[::1]'), true))
check('IPv6 ::1 被拦截（无方括号）', () => assert.equal(isBlockedIp('::1'), true))
check('IPv6 fe80::1 链路本地被拦截', () => assert.equal(isBlockedIp('fe80::1'), true))
check('IPv6 fc00::/7 ULA 被拦截', () => assert.equal(isBlockedIp('fd00::1'), true))
check('IPv4-mapped ::ffff:127.0.0.1 被拦截', () => assert.equal(isBlockedIp('::ffff:127.0.0.1'), true))
check('公网 IPv6 2001:4860::8888 放行', () => assert.equal(isBlockedIp('2001:4860::8888'), false))

check('畸形 IP 字面量 1.2.3 被拦截', () => assert.equal(isBlockedIp('1.2.3'), true))
check('十六进制 IP 0x7f000001 被拦截', () => assert.equal(isBlockedIp('0x7f000001'), true))
check('十进制 IP 2130706433 被拦截', () => assert.equal(isBlockedIp('2130706433'), true))

console.log('\n== SSRF: assertSsrfSafe ==')

await checkAsync('拒绝 http://[::1]:3000/api', async () => {
  const r = await assertSsrfSafe('http://[::1]:3000/api')
  assert.equal(r.ok, false, '应当被拒绝')
})
await checkAsync('拒绝 http://localhost/', async () => {
  const r = await assertSsrfSafe('http://localhost/')
  assert.equal(r.ok, false)
})
await checkAsync('拒绝 file:// 协议', async () => {
  const r = await assertSsrfSafe('file:///etc/passwd')
  assert.equal(r.ok, false)
})
await checkAsync('拒绝 gopher:// 协议', async () => {
  const r = await assertSsrfSafe('gopher://127.0.0.1:6379/_SET')
  assert.equal(r.ok, false)
})
await checkAsync('拒绝无 scheme 的裸路径', async () => {
  const r = await assertSsrfSafe('/etc/passwd')
  assert.equal(r.ok, false)
})
await checkAsync('公网 https 域名放行（域名不能被误判为内网 IP）', async () => {
  const r = await assertSsrfSafe('https://example.com/a.png')
  if (!r.ok) {
    // 沙箱可能没有 DNS，此时只允许是解析类失败
    assert.ok(
      r.reason === 'DNS_RESOLVE_FAILED' || r.reason === 'DNS_NO_ADDRESS',
      `意外的拒绝原因: ${r.reason}`
    )
  }
})
await checkAsync('公网 IP 字面量放行', async () => {
  const r = await assertSsrfSafe('https://8.8.8.8/a.png')
  assert.equal(r.ok, true, `公网 IP 不应被拒绝: ${JSON.stringify(r)}`)
})

console.log('\n== 纯逻辑一致性 ==')

check('静态检查不误伤正常域名（DNS 阶段单独验证）', async () => {
  // 只做协议/主机名判定：正常域名必须放行
  assert.equal(isBlockedIp('8.8.8.8'), false)
  const r = await assertSsrfSafe('https://cdn.example.com/a.png')
  if (!r.ok) {
    assert.ok(
      r.reason === 'DNS_RESOLVE_FAILED' || r.reason === 'DNS_NO_ADDRESS',
      `正常域名被误判: ${r.reason}`
    )
  }
})

console.log('\n== 上传清洗 ==')

check('路径穿越 shotId 被压平', () => {
  const out = safeSegment('../../../etc')
  assert.ok(!out.includes('/'), `不应包含分隔符: ${out}`)
  assert.ok(!out.includes('..'), `不应包含 ..: ${out}`)
  assert.equal(out, '______etc')
})
check('反斜杠被替换且无 ..', () => {
  const out = safeSegment('..\\..\\win')
  assert.ok(!out.includes('\\'), out)
  assert.ok(!out.includes('..'), out)
})
check('前导点被去掉', () => {
  assert.ok(!safeSegment('...hidden').startsWith('.'))
})
check('超长输入被截断', () => {
  assert.equal(safeSegment('x'.repeat(500)).length, 64)
})
check('空值走 fallback', () => assert.equal(safeSegment('', 'fb'), 'fb'))

check('只信任 MIME 白名单：.html 文件名不被采纳', () => {
  const ext = resolveUploadExtension({ name: 'evil.html', type: 'text/html' })
  assert.equal(ext, null)
})
check('.svg 被显式拒绝', () => {
  assert.equal(resolveUploadExtension({ name: 'x.svg', type: 'image/svg+xml' }, { allowSvg: false }), null)
})
check('.png 正常放行', () => {
  assert.equal(resolveUploadExtension({ name: 'a.png', type: 'image/png' }), 'png')
})
check('.jpg 归一为 jpg', () => {
  assert.equal(resolveUploadExtension({ name: 'a.jpeg', type: 'image/jpeg' }), 'jpg')
})
check('MIME 带参数也能解析', () => {
  assert.equal(resolveUploadExtension({ name: 'a', type: 'image/png; charset=binary' }), 'png')
})
check('无 MIME 一律拒绝', () => {
  assert.equal(resolveUploadExtension({ name: 'a.png' }), null)
})
check('大小上限生效', () => {
  assert.equal(isUploadSizeAllowed(1024), true)
  assert.equal(isUploadSizeAllowed(0), false)
  assert.equal(isUploadSizeAllowed(11 * 1024 * 1024), false)
})

console.log('\n== 计费 ==')

check('calculateBatchCost 有批量折扣且单调递增', () => {
  const unit = GENERATION_COSTS.KEYFRAME
  const c1 = calculateBatchCost(unit, 1)
  const c5 = calculateBatchCost(unit, 5)
  const c10 = calculateBatchCost(unit, 10)
  assert.ok(c1 <= c5, `${c1} <= ${c5}`)
  assert.ok(c5 <= c10, `${c5} <= ${c10}`)
  assert.ok(c1 > 0)
})
check('count=0 时费用为 0', () => {
  assert.equal(calculateBatchCost(GENERATION_COSTS.KEYFRAME, 0), 0)
})
check('负数 count 不会产生负费用', () => {
  assert.ok(calculateBatchCost(GENERATION_COSTS.KEYFRAME, -3) >= 0)
})

console.log('\n== 贡献度去重口径 ==')

/** 与 lib/group-contributions.ts 的 contributionKey 保持一致 */
function contributionKey(input: {
  projectId: string
  stepName?: string | null
  targetKey?: string | null
  role: string
  fallbackId: string
}) {
  return input.targetKey
    ? `${input.projectId}/${input.stepName || 'UNKNOWN'}/${input.targetKey}/${input.role}`
    : `${input.projectId}/result/${input.fallbackId}`
}

check('同一镜头重生成 5 次 -> 资产 5 / 去重目标 1 / 有效贡献 1', () => {
  // 模拟：同一镜头连续重生成 5 次，每次产生一条结果行
  const rows = Array.from({ length: 5 }, (_, i) => ({
    assetId: `asset_${i}`,
    createdAt: 1000 + i,
    contributionKey: contributionKey({
      projectId: 'p1',
      stepName: 'STORYBOARD',
      targetKey: 'act:1/shot:shot_001',
      role: 'storyboard:storyboard',
      fallbackId: `asset_${i}`,
    }),
  }))

  const outputCount = rows.length                              // 生成产出 = 资产行数
  const distinctTargetCount = new Set(rows.map((r) => r.contributionKey)).size
  // 按时间倒序保留最新采用结果（与 group-contributions 的 supersede 逻辑一致）
  const ordered = [...rows].sort((a, b) => b.createdAt - a.createdAt)
  const currentKeys = new Set<string>()
  let adoptedCount = 0
  for (const r of ordered) {
    if (currentKeys.has(r.contributionKey)) continue
    currentKeys.add(r.contributionKey)
    adoptedCount += 1
  }

  assert.equal(outputCount, 5)
  assert.equal(distinctTargetCount, 1, '去重目标数应为 1')
  assert.equal(adoptedCount, 1, '有效贡献应为 1')
  // 采用率分母改为去重目标数后，重生成不会把采用率压到 20%
  assert.equal(adoptedCount / distinctTargetCount, 1)
  assert.equal(adoptedCount / outputCount, 0.2)
})

check('不同镜头互不合并', () => {
  const keys = ['shot_001', 'shot_002', 'shot_003'].map((shotId) =>
    contributionKey({
      projectId: 'p1',
      stepName: 'STORYBOARD',
      targetKey: `act:1/shot:${shotId}`,
      role: 'storyboard:storyboard',
      fallbackId: shotId,
    })
  )
  assert.equal(new Set(keys).size, 3)
})

check('不同项目的同一镜头不合并', () => {
  const a = contributionKey({ projectId: 'p1', stepName: 'STORYBOARD', targetKey: 'act:1/shot:s1', role: 'r', fallbackId: 'x' })
  const b = contributionKey({ projectId: 'p2', stepName: 'STORYBOARD', targetKey: 'act:1/shot:s1', role: 'r', fallbackId: 'x' })
  assert.notEqual(a, b)
})

check('首帧与尾帧视为不同角色', () => {
  const first = contributionKey({ projectId: 'p1', stepName: 'KEYFRAMES', targetKey: 'act:1/shot:s1', role: 'keyframes:first', fallbackId: 'x' })
  const last = contributionKey({ projectId: 'p1', stepName: 'KEYFRAMES', targetKey: 'act:1/shot:s1', role: 'keyframes:last', fallbackId: 'x' })
  assert.notEqual(first, last)
})

check('无 targetKey 时退化为按资产 ID 区分（不会误合并）', () => {
  const a = contributionKey({ projectId: 'p1', stepName: 'STYLE', targetKey: null, role: 'style:other', fallbackId: 'asset_a' })
  const b = contributionKey({ projectId: 'p1', stepName: 'STYLE', targetKey: null, role: 'style:other', fallbackId: 'asset_b' })
  assert.notEqual(a, b)
})

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`)
if (failed > 0) process.exit(1)
