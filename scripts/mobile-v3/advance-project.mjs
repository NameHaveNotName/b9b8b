#!/usr/bin/env node
/**
 * AFF Mobile V3 — hourly project advancer.
 *
 * Drives the real AI Film Flow UI with a real authorized session so every
 * generation goes through the original callbacks, confirmation and points checks
 * (StepHeader「开始执行」→ 副工作台 →「确认并开始生成」→ executeStep).
 * It never calls the generation API directly and never changes app logic.
 *
 * Env:
 *   AFF_BASE_URL            default http://localhost:3000
 *   AFF_PROJECT_ID          target project for this run
 *   AFF_DEFAULT_PROJECT_ID  fallback target used by the hourly automation
 *   AFF_LOGIN_EMAIL / AFF_LOGIN_PASSWORD   credentials (never logged, never committed)
 *   AFF_SECRETS_FILE        json file { email, password } used when env vars are absent
 *   AFF_STORAGE_STATE       reuse an existing authorized session instead of logging in
 *   AFF_PLAYWRIGHT_MODULE / AFF_CHROMIUM_PATH
 *   AFF_MAX_STEPS           how many steps to advance in one run (default 1)
 *   AFF_STEP_TIMEOUT_MS     per-step wait for a terminal state (default 25 min)
 *   AFF_MIN_POINTS          refuse to run below this balance (default 500)
 *   AFF_DRY_RUN             1 = open the workbench but do NOT confirm the generation
 *   AFF_ARTIFACTS           output directory for logs and screenshots
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const E = process.env;
const base = (E.AFF_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const out = path.resolve(E.AFF_ARTIFACTS || path.join(process.cwd(), '.aff-advance'));
fs.mkdirSync(out, { recursive: true });
const logFile = path.join(out, 'advance.jsonl');
fs.writeFileSync(logFile, '');

const log = (event, data = {}) => {
  const entry = { at: new Date().toISOString(), event, ...data };
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf8');
  console.log('[' + event + '] ' + JSON.stringify(data));
};

const STEP_ORDER = ['idea', 'framework', 'style', 'character', 'concept', 'trailer', 'storyboard', 'ending', 'direct'];
const STEP_ID_TO_TYPE = {
  idea: 'IDEATION', framework: 'FRAMEWORK', style: 'STYLE', character: 'CHARACTER',
  concept: 'CONCEPT', trailer: 'TRAILER', storyboard: 'STORYBOARD', ending: 'KEYFRAMES', direct: 'VIDEO_DIRECT',
};
const STEP_LABELS = {
  idea: '创意扩散', framework: '框架搭建', style: '风格统一', character: '人物设计',
  concept: '概念图', trailer: '宣传片', storyboard: '分镜设计', ending: '生成尾帧', direct: '直生视频',
};

/* ---- read-only mirror of lib/workflow-state.ts (no app logic is changed) ---- */
const hasStoryboardImage = (shots) => Array.isArray(shots) && shots.some((s) => s && typeof s === 'object' &&
  [s.firstFrameUrl, s.referenceImageUrl, s.imageUrl, s.thumbnailUrl].some((v) => typeof v === 'string' && v.trim()));
const hasConceptImage = (step) => {
  if (!step) return false;
  if ((step.resultAssets || []).some((a) => a && a.type === 'IMAGE' && a.metadata?.isMock !== true && typeof a.url === 'string' && a.url.trim())) return true;
  const o = step.outputData;
  if (!o || typeof o !== 'object') return false;
  if ([o.url, o.imageUrl, o.storageKey].some((v) => typeof v === 'string' && v.trim())) return true;
  return ['scenes', 'images', 'results'].some((f) => Array.isArray(o[f]) && o[f].some((x) => x && typeof x === 'object' && typeof x.url === 'string' && x.url.trim()));
};
function computeState(project) {
  const steps = project.steps || [];
  const isDone = (t) => steps.some((s) => s.stepType === t && (s.status === 'COMPLETED' || s.status === 'SKIPPED'));
  const sb = steps.find((s) => s.stepType === 'STORYBOARD');
  const concept = steps.find((s) => s.stepType === 'CONCEPT');
  return {
    idea: isDone('IDEATION'), framework: isDone('FRAMEWORK'), style: isDone('STYLE'),
    character: isDone('CHARACTER'), concept: isDone('CONCEPT'),
    conceptImage: hasConceptImage(concept),
    storyboard: isDone('STORYBOARD'),
    storyboardImage: hasStoryboardImage(sb?.outputData?.shots),
    trailer: isDone('TRAILER'), ending: isDone('KEYFRAMES'), direct: isDone('VIDEO_DIRECT'),
  };
}
const UNLOCK = {
  idea: () => true, framework: () => true, style: (s) => s.framework, character: (s) => s.style,
  concept: (s) => s.character, trailer: (s) => s.conceptImage, storyboard: (s) => s.framework,
  ending: (s) => s.storyboardImage, direct: (s) => s.storyboardImage,
};
const HIDDEN = {
  idea: (s) => s.framework,
  framework: (s) => s.style || s.character || s.concept || s.storyboard,
  style: (s) => s.storyboard, character: (s) => s.storyboard, concept: (s) => s.trailer,
  storyboard: () => false, trailer: () => false, ending: () => false, direct: () => false,
};

/* ---------------------------- credentials ---------------------------- */
function loadCredentials() {
  if (E.AFF_LOGIN_EMAIL && E.AFF_LOGIN_PASSWORD) {
    return { email: E.AFF_LOGIN_EMAIL, password: E.AFF_LOGIN_PASSWORD };
  }
  const candidates = [E.AFF_SECRETS_FILE, path.join(process.cwd(), '.local-runner', 'secrets.json'), path.join(out, 'secrets.json')].filter(Boolean);
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const email = raw.email || raw.AFF_LOGIN_EMAIL;
      const password = raw.password || raw.AFF_LOGIN_PASSWORD;
      if (email && password) return { email, password };
    } catch { /* file may not exist yet */ }
  }
  return null;
}

const req = createRequire(path.join(process.cwd(), 'package.json'));
let pw;
try {
  pw = E.AFF_PLAYWRIGHT_MODULE
    ? await import(pathToFileURL(path.resolve(E.AFF_PLAYWRIGHT_MODULE)).href)
    : req('playwright');
} catch (e) {
  log('fatal', { reason: 'playwright unavailable: ' + e.message });
  process.exit(2);
}
const chromium = pw.chromium || pw.default?.chromium;

const projectId = E.AFF_PROJECT_ID || E.AFF_DEFAULT_PROJECT_ID;
if (!projectId) { log('fatal', { reason: 'AFF_PROJECT_ID / AFF_DEFAULT_PROJECT_ID missing' }); process.exit(2); }

const maxSteps = parseInt(E.AFF_MAX_STEPS || '1', 10);
const stepTimeoutMs = parseInt(E.AFF_STEP_TIMEOUT_MS || String(25 * 60 * 1000), 10);
const minPoints = parseInt(E.AFF_MIN_POINTS || '500', 10);
const dryRun = E.AFF_DRY_RUN === '1';

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(E.AFF_CHROMIUM_PATH ? { executablePath: E.AFF_CHROMIUM_PATH } : {}) });
  const ctx = await browser.newContext({
    ...(E.AFF_STORAGE_STATE && fs.existsSync(E.AFF_STORAGE_STATE) ? { storageState: E.AFF_STORAGE_STATE } : {}),
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 200)));

  /* ---------- session ---------- */
  await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);
  let authenticated = !/\/login(\/|$)/.test(new URL(page.url()).pathname);
  if (!authenticated) {
    const creds = loadCredentials();
    if (!creds) { log('fatal', { reason: 'not authenticated and no credentials available' }); process.exit(3); }
    await page.goto(base + '/login', { waitUntil: 'networkidle', timeout: 45000 });
    await page.locator('input[type=email]').fill(creds.email);
    await page.locator('input[type=password]').fill(creds.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForTimeout(4500);
    authenticated = !/\/login(\/|$)/.test(new URL(page.url()).pathname);
    log('login', { ok: authenticated });
    if (!authenticated) { log('fatal', { reason: 'login failed' }); process.exit(3); }
  } else {
    log('login', { ok: true, via: 'storage-state' });
  }

  const api = async (p) => {
    const res = await page.request.get(base + p);
    if (!res.ok()) throw new Error('GET ' + p + ' -> ' + res.status());
    return res.json();
  };

  const user = await api('/api/user');
  const points = user?.user?.points ?? 0;
  log('session', { points, isAdmin: !!user?.user?.isAdmin });
  if (points < minPoints) { log('fatal', { reason: 'insufficient points (' + points + ' < ' + minPoints + ')' }); process.exit(4); }

  let advanced = 0;
  while (advanced < maxSteps) {
    const detail = await api('/api/projects/' + encodeURIComponent(projectId));
    const project = detail.project;
    const state = computeState(project);
    const steps = project.steps || [];

    const candidates = STEP_ORDER.map((id, index) => {
      const type = STEP_ID_TO_TYPE[id];
      const record = steps.find((s) => s.stepType === type) || { stepType: type, status: 'PENDING' };
      return {
        id, index, type, record,
        unlocked: UNLOCK[id](state), hidden: HIDDEN[id](state), done: state[id], status: record.status,
      };
    });
    log('steps', { candidates: candidates.map((c) => ({ id: c.id, status: c.status, unlocked: c.unlocked, hidden: c.hidden, done: c.done })) });

    const target = candidates.find((c) => !c.done && !c.hidden && c.unlocked && (c.status === 'PENDING' || c.status === 'FAILED'));
    if (!target) { log('done', { reason: 'no runnable step left' }); break; }
    if (target.status === 'PROCESSING') { log('skip', { id: target.id, reason: 'already processing' }); break; }

    log('target', { id: target.id, label: STEP_LABELS[target.id], status: target.status });

    /* ----- drive the real UI ----- */
    await page.goto(base + '/project/' + encodeURIComponent(projectId) + '/workflow', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const stepper = page.locator('.aff-stage-list > div > button');
    await stepper.first().waitFor({ timeout: 30000 });
    await stepper.nth(target.index).click();
    await page.waitForTimeout(1500);

    const started = await page.getByRole('button', { name: '开始执行' }).first()
      .click({ timeout: 10000 }).then(() => true).catch(() => false);
    if (!started) {
      // STORYBOARD in PENDING without prompts exposes the mode picker instead.
      const mode = page.getByRole('button', { name: /实拍参考模式|视频生成模式/ }).first();
      const ok = await mode.click({ timeout: 8000 }).then(() => true).catch(() => false);
      if (!ok) { log('skip', { id: target.id, reason: 'no executable entry in UI' }); break; }
    }
    await page.waitForTimeout(1500);

    const drawer = page.locator('[role=dialog][aria-label=生成与执行]');
    const drawerOpen = await drawer.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    if (!drawerOpen) { log('skip', { id: target.id, reason: 'generation workbench did not open' }); break; }
    await page.screenshot({ path: path.join(out, 'workbench-' + target.id + '.png') }).catch(() => {});

    if (dryRun) {
      log('dry-run', { id: target.id, reason: 'workbench opened, confirmation skipped by AFF_DRY_RUN=1' });
      break;
    }

    const confirm = drawer.getByRole('button', { name: /确认并开始生成|按当前配置重新生成|从“.*”继续/ }).first();
    const confirmed = await confirm.click({ timeout: 15000 }).then(() => true).catch(() => false);
    if (!confirmed) { log('skip', { id: target.id, reason: 'confirmation button not clickable' }); break; }
    log('confirmed', { id: target.id });

    /* ----- poll for terminal state ----- */
    const deadline = Date.now() + stepTimeoutMs;
    let last = '';
    let finished = null;
    while (Date.now() < deadline) {
      await page.waitForTimeout(15000);
      const d = await api('/api/projects/' + encodeURIComponent(projectId));
      const rec = (d.project.steps || []).find((s) => s.stepType === target.type);
      const status = rec?.status || 'UNKNOWN';
      const line = target.type + ':' + status;
      if (line !== last) { log('poll', { id: target.id, status }); last = line; }
      if (status === 'COMPLETED' || status === 'SKIPPED') { finished = 'COMPLETED'; break; }
      if (status === 'FAILED') { finished = 'FAILED'; break; }
    }
    await page.screenshot({ path: path.join(out, 'after-' + target.id + '.png') }).catch(() => {});
    log('step-finished', { id: target.id, result: finished || 'TIMEOUT', pageErrors: pageErrors.slice(0, 5) });
    advanced += 1;
    if (finished !== 'COMPLETED') break;
  }

  const finalUser = await api('/api/user').catch(() => null);
  log('summary', { advanced, pointsAfter: finalUser?.user?.points ?? null, artifacts: out });
  await ctx.close();
} catch (e) {
  log('fatal', { reason: String((e && e.message) || e).slice(0, 400) });
  process.exitCode = 1;
} finally {
  await browser?.close();
}
console.log('artifacts:', out);
