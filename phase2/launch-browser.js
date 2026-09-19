'use strict';

// Phase 2 — Shared Browser launcher.
//
// Ownership model: the Recorder session owns the browser lifetime, NOT the MCP
// server. We start a dedicated, headed Chrome on a localhost-only debugging
// endpoint, then let chrome-devtools-mcp / playwright-mcp attach to it.
//
// Usage:
//   node phase2/launch-browser.js            # launch (or reuse) the dedicated Chrome
//   node phase2/launch-browser.js --stop     # close it
//   node phase2/launch-browser.js --status   # print endpoint + open pages

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Centralised configuration. The debug port MUST be stable because the MCP
// config in opencode.json hardcodes it. Change it here only, and update the
// MCP config to match.
// ---------------------------------------------------------------------------
const DEBUG_PORT = 9222;
const DEBUG_HOST = '127.0.0.1'; // localhost only — never 0.0.0.0
const ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.join(ROOT, '.runtime');
const PROFILE_DIR = path.join(RUNTIME, 'chrome-profile');
const STATE_FILE = path.join(RUNTIME, 'browser.json');
const MARKER = 'file:///' + path.join(__dirname, 'marker.html').replace(/\\/g, '/');
const LAUNCH_TIMEOUT_MS = 25000;

const log = (...a) => console.log('[browser]', ...a);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Chrome.exe not found. Set CHROME_PATH to override.');
}

function getJson(url, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
  });
}

const endpointBase = () => `http://${DEBUG_HOST}:${DEBUG_PORT}`;

async function waitForEndpoint() {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const v = await getJson(`${endpointBase()}/json/version`);
    if (v && v.webSocketDebuggerUrl) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

function writeState(state) {
  fs.mkdirSync(RUNTIME, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function launch() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const existing = await getJson(`${endpointBase()}/json/version`);
  if (existing) {
    const state = readState() || {};
    log(`debugging endpoint already up: ${endpointBase()}`);
    log(`websocket: ${existing.webSocketDebuggerUrl}`);
    log('reusing existing dedicated Chrome (no new instance launched)');
    return { reused: true, version: existing, state };
  }

  const chrome = findChrome();
  log(`chrome:            ${chrome}`);
  log(`profile:           ${PROFILE_DIR}`);
  log(`debugging endpoint ${endpointBase()} (bound to ${DEBUG_HOST})`);

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--remote-debugging-address=${DEBUG_HOST}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--window-size=1280,860',
    MARKER,
  ];

  const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
  child.unref();
  log(`launched pid=${child.pid}, waiting for endpoint...`);

  const version = await waitForEndpoint();
  if (!version) {
    log('ERROR: endpoint did not become ready in time.');
    process.exit(1);
  }

  log('debugging endpoint ready');
  log(`  browser:   ${version.Browser}`);
  log(`  websocket: ${version.webSocketDebuggerUrl}`);

  writeState({
    pid: child.pid,
    port: DEBUG_PORT,
    host: DEBUG_HOST,
    httpEndpoint: endpointBase(),
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
    profileDir: PROFILE_DIR,
    startedAt: new Date().toISOString(),
  });
  return { reused: false, version };
}

async function status() {
  const version = await getJson(`${endpointBase()}/json/version`);
  const pages = await getJson(`${endpointBase()}/json/list`);
  if (!version) {
    log(`not running (no endpoint at ${endpointBase()})`);
    return;
  }
  log(`running: ${version.Browser}`);
  log(`endpoint: ${endpointBase()}`);
  log(`websocket: ${version.webSocketDebuggerUrl}`);
  const list = Array.isArray(pages) ? pages.filter((p) => p.type === 'page') : [];
  log(`open pages (${list.length}):`);
  for (const p of list) log(`  - [${p.title}] ${p.url}`);
}

function taskkillTree(pid) {
  return new Promise((resolve) => {
    // PID-scoped only. Never `taskkill /IM chrome.exe` — that would also kill
    // the user's daily Chrome and the MCP's own browser.
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      .on('exit', (code) => resolve(code === 0));
  });
}

async function stop() {
  const state = readState();
  if (!state || !state.pid) {
    log('no launcher state found (.runtime/browser.json); nothing to stop.');
    log('refusing to taskkill by image name — close the dedicated window manually if needed.');
    return;
  }
  if (!isAlive(state.pid)) {
    log(`pid ${state.pid} is not alive; clearing stale state`);
    fs.rmSync(STATE_FILE, { force: true });
    return;
  }
  const ok = await taskkillTree(state.pid);
  log(ok ? `terminated pid ${state.pid} (and children)` : `failed to terminate pid ${state.pid}`);
  fs.rmSync(STATE_FILE, { force: true });
}

(async () => {
  const cmd = process.argv[2] || '--launch';
  if (cmd === '--stop') return stop();
  if (cmd === '--status') return status();
  return launch();
})().catch((e) => { console.error('[browser] ERROR:', e.message); process.exit(1); });
