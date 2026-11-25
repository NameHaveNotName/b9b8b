#!/usr/bin/env node
/** List the signed-in user's projects with their nine workflow step states (read-only). */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const E = process.env;
const base = (E.AFF_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const req = createRequire(path.join(process.cwd(), 'package.json'));
const pw = E.AFF_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(path.resolve(E.AFF_PLAYWRIGHT_MODULE)).href)
  : req('playwright');
const chromium = pw.chromium || pw.default?.chromium;
const TYPES = ['IDEATION','FRAMEWORK','STYLE','CHARACTER','CONCEPT','TRAILER','STORYBOARD','KEYFRAMES','VIDEO_DIRECT'];
const browser = await chromium.launch({ headless: true, ...(E.AFF_CHROMIUM_PATH ? { executablePath: E.AFF_CHROMIUM_PATH } : {}) });
const ctx = await browser.newContext({ storageState: E.AFF_STORAGE_STATE, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(2500);
const list = await page.request.get(base + '/api/projects').then(r => r.json());
const rows = [];
for (const p of (list.projects || [])) {
  const d = await page.request.get(base + '/api/projects/' + encodeURIComponent(p.id)).then(r => r.json());
  const pr = d.project; if (!pr) continue;
  const steps = pr.steps || [];
  const byType = Object.fromEntries(steps.map(s => [s.stepType, s.status]));
  const shots = steps.find(s => s.stepType === 'STORYBOARD')?.outputData?.shots;
  rows.push({
    id: p.id, title: p.title, updatedAt: pr.updatedAt,
    steps: Object.fromEntries(TYPES.map(t => [t, byType[t] || 'MISSING'])),
    shots: Array.isArray(shots) ? shots.length : 0,
    firstFrames: Array.isArray(shots) ? shots.filter(s => s && (s.firstFrameUrl || s.referenceImageUrl)).length : 0,
  });
}
console.log(JSON.stringify(rows, null, 2));
await browser.close();
