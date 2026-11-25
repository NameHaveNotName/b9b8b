#!/usr/bin/env node
/**
 * Desktop regression probe: capture the same desktop routes from two servers
 * (patched branch vs. clean baseline commit) and diff layout metrics.
 *
 * Env:
 *   AFF_BASE_URL       patched server (e.g. http://localhost:3000)
 *   AFF_BASELINE_URL   baseline server (e.g. http://localhost:3001)
 *   AFF_PROJECT_ID
 *   AFF_STORAGE_STATE
 *   AFF_ARTIFACTS
 *   AFF_PLAYWRIGHT_MODULE / AFF_CHROMIUM_PATH
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const E = process.env;
const req = createRequire(path.join(process.cwd(), 'package.json'));
const pw = E.AFF_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(path.resolve(E.AFF_PLAYWRIGHT_MODULE)).href)
  : req('playwright');
const chromium = pw.chromium || pw.default?.chromium;

const projectId = E.AFF_PROJECT_ID;
const out = path.resolve(E.AFF_ARTIFACTS || '.aff-desktop-regression');
fs.mkdirSync(out, { recursive: true });

const projectPath = '/project/' + encodeURIComponent(projectId);
const allRoutes = [
  ['home', '/'], ['login', '/login'], ['dashboard', '/dashboard'],
  ['project', projectPath], ['workflow', projectPath + '/workflow'],
  ['storyboard', projectPath + '/storyboard'], ['project-assets', projectPath + '/assets'],
  ['assets', '/assets'], ['new-project', '/project/new'], ['series', '/series'],
  ['groups', '/groups'], ['invitations', '/invitations'], ['settings', '/settings'],
  ['profile', '/settings/profile'], ['recharges', '/settings/recharges'],
];
const routeFilter = (E.AFF_ROUTES || '').split(',').map(s => s.trim()).filter(Boolean);
const routes = routeFilter.length ? allRoutes.filter(r => routeFilter.includes(r[0])) : allRoutes;

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: ' + label)), ms)),
]);

async function capture(base, width, tag) {
  const browser = await chromium.launch({ headless: true, ...(E.AFF_CHROMIUM_PATH ? { executablePath: E.AFF_CHROMIUM_PATH } : {}) });
  const ctx = await browser.newContext({ storageState: E.AFF_STORAGE_STATE, viewport: { width, height: 900 } });
  await ctx.route('**/*', (r) => {
    if (!r.request().url().startsWith(base)) return r.continue();
    return ['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 160)));
  const results = {};
  for (const [name, route] of routes) {
    errors.length = 0;
    try {
      await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // wait for the client bundle to hydrate enough to render real content
      await withTimeout(page.waitForFunction(() => (document.body.innerText || '').length > 200, null, { timeout: 30000 })
        .catch(() => {}), 32000, 'hydrate ' + name);
      await page.waitForTimeout(1200);
      const m = await withTimeout(page.evaluate(() => {
        const root = document.documentElement;
        const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
        return {
          pageOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
          scrollHeight: root.scrollHeight,
          textLength: text.length,
          textSample: text.slice(0, 400),
          buttons: document.querySelectorAll('button').length,
          links: document.querySelectorAll('a').length,
          images: document.querySelectorAll('img').length,
          selects: document.querySelectorAll('select').length,
          textareas: document.querySelectorAll('textarea').length,
          inputs: document.querySelectorAll('input').length,
          navLinks: document.querySelectorAll('aside a, nav a').length,
        };
      }), 20000, 'evaluate ' + name);
      m.pageErrors = errors.slice();
      await withTimeout(page.screenshot({ path: path.join(out, `${tag}-${width}-${name}.png`), fullPage: false, animations: 'disabled', timeout: 20000 }), 22000, 'screenshot ' + name)
        .catch(() => {});
      results[name] = m;
    } catch (e) {
      results[name] = { error: String(e && e.message || e).slice(0, 200) };
    }
  }
  await browser.close();
  return results;
}

const width = parseInt(E.AFF_WIDTH || '1440', 10);
const patched = await capture(E.AFF_BASE_URL.replace(/\/$/, ''), width, 'patched');
const baseline = await capture(E.AFF_BASELINE_URL.replace(/\/$/, ''), width, 'baseline');

const diffs = [];
for (const name of Object.keys(patched)) {
  const a = patched[name], b = baseline[name];
  if (!a || !b) { diffs.push({ name, note: 'missing capture' }); continue; }
  const keys = ['pageOverflow', 'buttons', 'links', 'images', 'selects', 'textareas', 'inputs', 'navLinks'];
  const changed = {};
  for (const k of keys) if (a[k] !== b[k]) changed[k] = { patched: a[k], baseline: b[k] };
  if (a.pageErrors.length !== b.pageErrors.length) changed.pageErrors = { patched: a.pageErrors.length, baseline: b.pageErrors.length };
  if (Math.abs((a.textLength || 0) - (b.textLength || 0)) > 40) changed.textLength = { patched: a.textLength, baseline: b.textLength };
  diffs.push({ name, changed, patchedErrors: a.pageErrors, baselineErrors: b.pageErrors });
}
const report = { width, patched, baseline, diffs };
fs.writeFileSync(path.join(out, `desktop-regression-${width}.json`), JSON.stringify(report, null, 2));
for (const d of diffs) {
  console.log(d.name, Object.keys(d.changed || {}).length ? JSON.stringify(d.changed) : 'identical');
}
console.log('artifacts:', out);
