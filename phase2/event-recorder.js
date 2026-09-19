'use strict';

/*
 * Phase 2B — Event Recorder (Observer).
 *
 * Connects to the Recorder-owned Dedicated Chrome over CDP and records the
 * interaction events that really happen in the page. It is a pure observer:
 *
 *   - allowed: connect, inject listener, read metadata, write log, disconnect
 *   - forbidden: page.click/fill/type/press/goto/reload, or any control API
 *
 * Node owns the global timeline (t, seq, pageId, frame, url); the page only
 * reports what happened and where.
 *
 * Usage:
 *   npm run phase2:events
 *   npm run phase2:events -- --duration 60      # auto-stop after 60s (test aid)
 *   npm run phase2:events -- --endpoint http://127.0.0.1:9222
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:9222';
const INJECT_PATH = path.join(__dirname, 'event-recorder.inject.js');
const OUT_BASE = path.join(__dirname, 'output', 'sessions');
const SCROLL_THROTTLE_MS = 100;

// ---- args ------------------------------------------------------------------

function parseArgs(argv) {
  const out = { endpoint: process.env.PHASE2_CDP || DEFAULT_ENDPOINT, durationSec: 0, label: '', stopFile: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--duration') out.durationSec = Number(argv[++i]) || 0;
    else if (a.startsWith('--duration=')) out.durationSec = Number(a.split('=')[1]) || 0;
    else if (a === '--endpoint') out.endpoint = argv[++i] || out.endpoint;
    else if (a.startsWith('--endpoint=')) out.endpoint = a.split('=')[1];
    else if (a === '--label') out.label = argv[++i] || '';
    else if (a === '--stop-file') out.stopFile = argv[++i] || '';
    else if (a.startsWith('--stop-file=')) out.stopFile = a.split('=')[1];
    else if (a === '--heartbeat') out.heartbeat = true;
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const log = (...a) => console.log('[event-recorder]', ...a);
const logEvent = (s) => console.log('[event]', s);

// ---- session clock ---------------------------------------------------------

const T0 = process.hrtime.bigint();
const nowMs = () => Number(process.hrtime.bigint() - T0) / 1e6;
const r2 = (n) => Math.round(n * 100) / 100;

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

const SESSION_ID = 'events-' + stamp() + (ARGS.label ? '-' + ARGS.label : '');
const SESSION_DIR = path.join(OUT_BASE, SESSION_ID);
const EVENTS_PATH = path.join(SESSION_DIR, 'events.jsonl');
const SESSION_PATH = path.join(SESSION_DIR, 'session.json');
const SUMMARY_PATH = path.join(SESSION_DIR, 'summary.json');

let seq = 0;
const counts = {};
let startedAt = new Date().toISOString();
const pageIds = new WeakMap();
let pageCounter = 0;
let stopped = false;

function idFor(page) {
  if (!pageIds.has(page)) pageIds.set(page, 'p' + (++pageCounter));
  return pageIds.get(page);
}

// ---- recording -------------------------------------------------------------

function record(payload, source) {
  const t = r2(nowMs());
  const seqNo = ++seq;

  let pageId = null;
  let frame = { kind: 'main' };
  let url = payload.url || null;

  if (source && source.page) {
    pageId = idFor(source.page);
    let mainFrame = null;
    try { mainFrame = source.page.mainFrame(); } catch (_) {}
    if (source.frame && mainFrame && source.frame !== mainFrame) {
      frame = { kind: 'child' };
      try { frame.url = source.frame.url(); } catch (_) {}
    }
    if (!url) {
      try { url = source.frame ? source.frame.url() : source.page.url(); } catch (_) {}
    }
  }

  const ev = Object.assign({ v: 1, seq: seqNo, t }, payload, { pageId, frame, url });
  counts[ev.type] = (counts[ev.type] || 0) + 1;

  // Incremental persistence: survive a crash mid-session.
  try { fs.appendFileSync(EVENTS_PATH, JSON.stringify(ev) + '\n'); } catch (e) {
    log('write failed:', e.message);
  }

  logEvent(formatLine(ev));
  return ev;
}

function describeShort(target) {
  if (!target) return '';
  let s = target.tag || '?';
  if (target.id) s += '#' + target.id;
  if (target.label) s += ' "' + String(target.label).slice(0, 32) + '"';
  return s;
}

function formatLine(ev) {
  const p = ev.pageId || '-';
  switch (ev.type) {
    case 'navigation':
      return `navigation ${p} ${ev.url}`;
    case 'pointerdown':
      return `pointerdown ${p} ${describeShort(ev.target)} @${ev.point.x},${ev.point.y}`;
    case 'click':
      return `click ${p} ${describeShort(ev.target)} @${ev.point.x},${ev.point.y} rect=${ev.target ? ev.target.rect.width + 'x' + ev.target.rect.height : '?'}`;
    case 'input':
      return `input ${p} ${describeShort(ev.target)} len=${ev.input && ev.input.valueLength}${ev.input && ev.input.masked ? ' masked' : ''}`;
    case 'change':
      return `change ${p} ${describeShort(ev.target)} idx=${ev.change && ev.change.selectedIndex}`;
    case 'keydown':
      return `keydown ${p} ${ev.key}${ev.modifiers && (ev.modifiers.ctrl || ev.modifiers.meta || ev.modifiers.alt) ? ' (shortcut)' : ''}`;
    case 'scroll':
      return `scroll ${p} ${ev.target ? describeShort(ev.target) + ' ' : ''}y=${ev.scroll && ev.scroll.y}`;
    default:
      return ev.type + ' ' + p;
  }
}

// ---- wiring ----------------------------------------------------------------

const injectSrc = fs.readFileSync(INJECT_PATH, 'utf8');

function buildScripts(bindingName) {
  const cfgJson = JSON.stringify({ binding: bindingName, scrollThrottleMs: SCROLL_THROTTLE_MS });
  return {
    bindingName,
    initContent: `window.__UI_RECORDER_CFG__ = ${cfgJson};\n${injectSrc}`,
    evalContent: `(() => {\nwindow.__UI_RECORDER_CFG__ = ${cfgJson};\n${injectSrc}\n})()`,
  };
}

const wired = new WeakSet();

async function installPage(page, scripts) {
  idFor(page);
  if (!wired.has(page)) {
    wired.add(page);
    page.on('framenavigated', async (frame) => {
      let isMain = false;
      try { isMain = frame === page.mainFrame(); } catch (_) {}
      if (!isMain) return;
      let title = '';
      try { title = await page.title(); } catch (_) {}
      record({ type: 'navigation', url: frame.url(), title }, { page, frame });
    });
  }
  // Existing documents (main + attached child frames) don't get init scripts
  // retroactively, so install explicitly. The page-side guard prevents stacks.
  try { await page.evaluate(scripts.evalContent); } catch (_) {}
  for (const f of page.frames()) {
    try { if (f !== page.mainFrame()) await f.evaluate(scripts.evalContent); } catch (_) {}
  }
  // Self-check: confirm the observer is actually installed and the binding exists.
  try {
    const ok = await page.evaluate((b) => ({
      installed: !!(window.__uiRecorderAgent_v1 && window.__uiRecorderAgent_v1.binding),
      bindingReady: typeof window[b] === 'function',
    }), scripts.bindingName);
    log(`  ${idFor(page)} inject: installed=${ok.installed} bindingReady=${ok.bindingReady}`);
  } catch (_) {}
}

// ---- main ------------------------------------------------------------------

async function main() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify({
    version: 1,
    phase: '2B',
    sessionId: SESSION_ID,
    startedAt,
    endedAt: null,
    durationMs: null,
    eventCount: 0,
    cdpEndpoint: ARGS.endpoint,
    observer: { mode: 'playwright-connect-over-cdp', controlBrowser: false },
  }, null, 2));

  log(`session ${SESSION_ID}`);
  log(`connecting ${ARGS.endpoint}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(ARGS.endpoint);
  } catch (e) {
    log('ERROR: could not connect to the Dedicated Chrome.');
    log('       start it first:  npm run phase2:browser');
    log('       (' + e.message.split('\n')[0] + ')');
    process.exit(1);
  }

  const bindingName = '__uiRecorderAgentEmit_' + stamp() + Math.floor(Math.random() * 1e6);
  const scripts = buildScripts(bindingName);
  const contexts = browser.contexts();
  log(`attached; contexts=${contexts.length}`);

  let pageCount = 0;
  for (const context of contexts) {
    await context.exposeBinding(bindingName, (source, payload) => {
      try { record(payload, source); } catch (e) { log('record failed:', e.message); }
    });
    await context.addInitScript({ content: scripts.initContent });
    context.on('page', (page) => {
      installPage(page, scripts).catch(() => {});
    });
    for (const page of context.pages()) {
      await installPage(page, scripts);
      pageCount++;
    }
  }
  log(`pages: ${pageCount}`);
  log(`output: ${SESSION_DIR}`);

  if (ARGS.durationSec > 0) {
    log(`auto-stop after ${ARGS.durationSec}s`);
    setTimeout(() => shutdown('duration'), ARGS.durationSec * 1000);
  }

  if (ARGS.stopFile) {
    try { fs.rmSync(ARGS.stopFile, { force: true }); } catch (_) {}
    log(`auto-stop when file appears: ${ARGS.stopFile}`);
    const iv = setInterval(() => {
      if (fs.existsSync(ARGS.stopFile)) { clearInterval(iv); shutdown('stop-file'); }
    }, 250);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (e) => { log('uncaughtException:', e.message); shutdown('crash'); });
  process.on('unhandledRejection', (e) => { log('unhandledRejection:', e && e.message); });

  if (ARGS.heartbeat) {
    let last = 0;
    setInterval(() => {
      if (seq !== last) { log(`+${seq - last} events (total ${seq})`); last = seq; }
    }, 5000);
  }

  log('observing (observer only — no browser control)');
}

async function shutdown(reason) {
  if (stopped) return;
  stopped = true;
  log(`stopping (${reason})...`);
  await new Promise((r) => setTimeout(r, 250));

  const endedAt = new Date().toISOString();
  const durationMs = Math.round(nowMs());

  try {
    fs.writeFileSync(SESSION_PATH, JSON.stringify({
      version: 1,
      phase: '2B',
      sessionId: SESSION_ID,
      startedAt,
      endedAt,
      durationMs,
      eventCount: seq,
      cdpEndpoint: ARGS.endpoint,
      observer: { mode: 'playwright-connect-over-cdp', controlBrowser: false },
    }, null, 2));

    fs.writeFileSync(SUMMARY_PATH, JSON.stringify({
      sessionId: SESSION_ID,
      startedAt,
      endedAt,
      durationMs,
      eventCount: seq,
      counts,
    }, null, 2));
  } catch (e) {
    log('flush failed:', e.message);
  }

  log(`${seq} events written`);
  log(`page ids: ${pageCounter}`);
  log(`output: ${SESSION_DIR}`);
  // The Dedicated Chrome is intentionally left running (observer must not control it).
  process.exit(0);
}

main().catch((e) => { log('FATAL', e.stack || e.message); process.exit(1); });
