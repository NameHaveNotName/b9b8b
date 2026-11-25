#!/usr/bin/env node
/**
 * AFF Mobile V3 验收巡检器
 *
 * 用法（环境变量）：
 *   AFF_BASE_URL        目标站点，如 http://localhost:3000
 *   AFF_PROJECT_ID      成熟测试项目 ID（九阶段尽量有数据）
 *   AFF_STORAGE_STATE   已授权会话的 Playwright storage state 路径
 *   AFF_ARTIFACTS       截图与报告输出目录
 *   AFF_PLAYWRIGHT_MODULE  可导入的 playwright 入口（绝对路径）
 *   AFF_CHROMIUM_PATH   已安装浏览器可执行文件
 *   AFF_VIEWPORTS       逗号分隔，默认 320,390,430,768,1440
 *   AFF_ALLOW_WRITES    置 1 时允许写请求（默认全部拦截，只读巡检）
 *   AFF_ONLY            可选，只跑指定路由/用例前缀
 *
 * 设计：结果逐行写入 JSONL，进程被中断也不会丢失已完成的证据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const E = process.env;
const base = (E.AFF_BASE_URL || '').replace(/\/$/, '');
const projectId = E.AFF_PROJECT_ID;
const out = path.resolve(E.AFF_ARTIFACTS || path.join(process.cwd(), '.aff-acceptance'));
const viewports = (E.AFF_VIEWPORTS || '320,390,430,768,1440').split(',').map(v => parseInt(v.trim(), 10)).filter(Boolean);
const allowWrites = E.AFF_ALLOW_WRITES === '1';
const onlyList = (E.AFF_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);

if (!base || !projectId || !E.AFF_STORAGE_STATE) {
  console.error('Set AFF_BASE_URL, AFF_PROJECT_ID, AFF_STORAGE_STATE.');
  process.exit(2);
}
const req = createRequire(path.join(process.cwd(), 'package.json'));
let pw;
try {
  pw = E.AFF_PLAYWRIGHT_MODULE
    ? await import(pathToFileURL(path.resolve(E.AFF_PLAYWRIGHT_MODULE)).href)
    : req('playwright');
} catch (e) {
  console.error('Playwright unavailable:', e.message);
  process.exit(2);
}
const chromium = pw.chromium || pw.default?.chromium;

fs.mkdirSync(out, { recursive: true });
const jsonl = path.join(out, 'acceptance.jsonl');
fs.writeFileSync(jsonl, '');
const record = (entry) => {
  fs.appendFileSync(jsonl, JSON.stringify(entry) + '\n', 'utf8');
  const flag = entry.status === 'PASS' ? 'PASS' : entry.status;
  console.log(`${flag} ${entry.test}${entry.status === 'PASS' ? '' : ' :: ' + JSON.stringify(entry.detail || {}).slice(0, 400)}`);
};

const projectPath = '/project/' + encodeURIComponent(projectId);
const routes = [
  ['home', '/'], ['login', '/login'], ['dashboard', '/dashboard'],
  ['project', projectPath], ['workflow', projectPath + '/workflow'],
  ['storyboard', projectPath + '/storyboard'], ['project-assets', projectPath + '/assets'],
  ['assets', '/assets'], ['new-project', '/project/new'], ['series', '/series'],
  ['groups', '/groups'], ['invitations', '/invitations'], ['settings', '/settings'],
  ['profile', '/settings/profile'], ['recharges', '/settings/recharges'],
];
// The series detail route needs a series that really belongs to the signed-in
// account; a hard-coded id only produces a meaningless 404. It is resolved at
// runtime from GET /api/series.
let seriesId = null;
const stepNames = ['创意扩散', '框架搭建', '风格统一', '人物设计', '概念图', '宣传片', '分镜设计', '生成尾帧', '直生视频'];

const safePath = (u) => { try { return new URL(u).pathname.replaceAll(encodeURIComponent(projectId), ':project').replaceAll(projectId, ':project'); } catch { return '(unknown)'; } };
const authenticated = (page) => !/\/login(?:\/|$)/.test(new URL(page.url()).pathname);

/** 溢出检测：返回整页与内容区溢出量，并列出真正超出视口的元素 */
async function overflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const content = document.querySelector('.aff-content');
    const vw = root.clientWidth;
    const offenders = [];
    // A design-intent horizontal scroller (e.g. the storyboard canvas track) legitimately
    // places children outside the viewport; only report elements that are not clipped by one.
    const insideScroller = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ps = getComputedStyle(p);
        if ((ps.overflowX === 'auto' || ps.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
        p = p.parentElement;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed') continue;
      // 允许显式声明横向滚动的容器
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
      if (insideScroller(el)) continue;
      if (r.right > vw + 1.5 || r.left < -1.5) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 110),
          left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 50),
        });
      }
    }
    // 只保留最外层的越界元素，避免子元素刷屏
    const trimmed = offenders.filter(o => !offenders.some(p => p !== o && p.left <= o.left && p.right >= o.right && p.width > o.width));
    return {
      page: Math.max(0, root.scrollWidth - root.clientWidth),
      content: content ? Math.max(0, content.scrollWidth - content.clientWidth) : 0,
      vw,
      offenders: trimmed.slice(0, 8),
    };
  });
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(E.AFF_CHROMIUM_PATH ? { executablePath: E.AFF_CHROMIUM_PATH } : {}),
  });

  for (const width of viewports) {
    const ctx = await browser.newContext({
      storageState: E.AFF_STORAGE_STATE,
      viewport: { width, height: width === 1440 ? 900 : 844 },
      isMobile: width < 768,
      hasTouch: width < 768,
      deviceScaleFactor: 1,
    });
    if (!allowWrites) {
      await ctx.route('**/*', (route) => {
        const m = route.request().method();
        // Only same-origin write traffic is blocked. Third-party session-refresh calls
        // (Supabase auth) must stay reachable, otherwise the browser reports
        // ERR_BLOCKED_BY_CLIENT noise that has nothing to do with the application.
        const url = route.request().url();
        if (!url.startsWith(base)) return route.continue();
        // Next.js dev-overlay source-map lookups are tooling, not application writes.
        if (new URL(url).pathname.startsWith('/__nextjs')) return route.continue();
        return ['GET', 'HEAD', 'OPTIONS'].includes(m) ? route.continue() : route.abort('blockedbyclient');
      });
    }
    const page = await ctx.newPage();
    if (!seriesId) {
      try {
        const res = await page.request.get(base + '/api/series');
        if (res.ok()) {
          const data = await res.json();
          seriesId = data?.series?.[0]?.id || null;
        }
      } catch { seriesId = null; }
    }
    const viewRoutes = seriesId
      ? [...routes, ['series-detail', '/series/' + encodeURIComponent(seriesId)]]
      : routes;
    let consoleErrs = [], pageErrs = [], httpErrs = [], writes = [];

    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 220)); });
    page.on('pageerror', (e) => pageErrs.push(String(e && e.message || e).slice(0, 220)));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(base)) httpErrs.push({ path: safePath(r.url()), status: r.status() }); });
    page.on('request', (r) => {
      // Only same-origin writes are interesting; third-party auth refreshes are normal.
      if (!r.url().startsWith(base)) return;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes.push({ path: safePath(r.url()), method: r.method() });
    });

    const reset = () => { consoleErrs = []; pageErrs = []; httpErrs = []; writes = []; };

    for (const [name, route] of viewRoutes) {
      const test = `${width}/${name}`;
      if (onlyList.length && !onlyList.some(o => test.includes(o))) continue;
      reset();
      try {
        let response;
        try {
          response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (err) {
          // A client-side redirect can abort the initial navigation; retry once.
          await page.waitForTimeout(1200);
          response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
        }
        if (name === 'workflow' && authenticated(page)) await page.locator('.aff-stage-list').waitFor({ timeout: 25000 }).catch(() => {});
        else if (!['home', 'login'].includes(name) && authenticated(page)) await page.locator('.aff-content').waitFor({ timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(700);
        // Let in-flight shell fetches settle so a navigation never aborts them.
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.screenshot({ path: path.join(out, `${width}-${name}.png`), fullPage: false });
        if (!['home', 'login'].includes(name) && !authenticated(page)) {
          record({ test, status: 'BLOCKED', detail: { reason: 'auth redirect' } });
          continue;
        }
        const over = await overflow(page);
        const fail = (response && response.status() >= 400) || over.page > 1 || over.content > 1 || pageErrs.length || httpErrs.length || writes.length;
        record({
          test, status: fail ? 'FAIL' : 'PASS',
          detail: {
            statusCode: response && response.status(),
            overflow: { page: over.page, content: over.content },
            offenders: over.offenders,
            pageErrors: pageErrs, consoleErrors: consoleErrs.slice(0, 4), httpErrors: httpErrs.slice(0, 6), blockedWrites: writes.slice(0, 6),
          },
        });
      } catch (e) {
        record({ test, status: 'FAIL', detail: { reason: 'navigation failed: ' + String(e && e.message || e).slice(0, 200) } });
        try { await page.screenshot({ path: path.join(out, `${width}-${name}-failure.png`) }); } catch {}
      }
      if (name !== 'workflow') continue;

      // 九阶段逐个点击
      const stepper = page.locator('.aff-stage-list > div > button');
      const count = await stepper.count();
      record({ test: `${width}/stage-count`, status: count === 9 ? 'PASS' : 'FAIL', detail: { count } });
      for (let i = 0; i < count; i++) {
        reset();
        const t = `${width}/step-${i + 1}-${stepNames[i]}`;
        const btn = stepper.nth(i);
        try {
          if (!await btn.isVisible()) { record({ test: t, status: 'FAIL', detail: { reason: 'stage not visible' } }); continue; }
          const disabled = await btn.isDisabled();
          await btn.click({ timeout: 8000 });
          await page.waitForTimeout(600);
          const current = await btn.getAttribute('aria-current');
          const over = await overflow(page);
          await page.screenshot({ path: path.join(out, `${width}-stage-${i + 1}.png`), fullPage: false });
          const ok = current === 'step' && over.page <= 1 && over.content <= 1 && !pageErrs.length && !httpErrs.length && !writes.length;
          record({
            test: t, status: ok ? 'PASS' : 'FAIL',
            detail: {
              disabledByState: disabled, current, overflow: { page: over.page, content: over.content },
              offenders: over.offenders, pageErrors: pageErrs, consoleErrors: consoleErrs.slice(0, 4), httpErrors: httpErrs.slice(0, 6), blockedWrites: writes.slice(0, 6),
            },
          });
        } catch (e) {
          record({ test: t, status: 'FAIL', detail: { reason: 'stage click failed: ' + String(e && e.message || e).slice(0, 180) } });
          try { await page.screenshot({ path: path.join(out, `${width}-stage-${i + 1}-failure.png`) }); } catch {}
        }
      }

      // 框架原地折叠（手机）
      if (width < 768) {
        reset();
        // 折叠模块只存在于「框架搭建」步骤，先切过去再测原地展开
        try {
          await stepper.nth(1).click({ timeout: 8000 });
          await page.waitForTimeout(900);
        } catch (e) {
          record({ test: `${width}/framework-inline-fold`, status: 'BLOCKED', detail: { reason: 'cannot open framework step: ' + String(e && e.message || e).slice(0, 160) } });
          continue;
        }
        const folds = page.locator('.aff-section-toggle');
        if (await folds.count()) {
          const before = page.url();
          const initial = await folds.first().getAttribute('aria-expanded');
          await folds.first().click();
          await page.waitForTimeout(500);
          const opened = await folds.first().getAttribute('aria-expanded');
          const over = await overflow(page);
          await page.screenshot({ path: path.join(out, `${width}-framework-expanded.png`), fullPage: false });
          const ok = initial === 'false' && opened === 'true' && page.url() === before && over.page <= 1;
          record({ test: `${width}/framework-inline-fold`, status: ok ? 'PASS' : 'FAIL', detail: { initial, opened, sameRoute: page.url() === before, overflow: { page: over.page, content: over.content }, offenders: over.offenders, pageErrors: pageErrs } });
        } else {
          record({ test: `${width}/framework-inline-fold`, status: 'BLOCKED', detail: { reason: 'no framework sections' } });
        }
      }
    }
    if (!seriesId) {
      record({ test: `${width}/series-detail`, status: 'BLOCKED', detail: { reason: 'signed-in account has no series to open' } });
    }
    await ctx.close();
  }
} catch (e) {
  record({ test: 'harness', status: 'FAIL', detail: { reason: String(e && e.message || e).slice(0, 300) } });
} finally {
  await browser?.close();
}
console.log('artifacts:', out);
