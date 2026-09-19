'use strict';

// Phase 2A — Shared Browser PoC harness.
//
// Spawns a real `chrome-devtools-mcp` server pointed at the Recorder-owned
// Chrome (--browserUrl), speaks MCP over stdio, and drives a small operation
// sequence. This proves "MCP -> our Chrome" independently of whether the
// in-session OpenCode MCP has been restarted yet.
//
//   node phase2/mcp-smoke-test.js
//   BROWSER_URL=http://127.0.0.1:9222 node phase2/mcp-smoke-test.js

const path = require('path');
const fs = require('fs');
const http = require('http');
const readline = require('readline');
const { spawn } = require('child_process');

const BROWSER_URL = process.env.BROWSER_URL || 'http://127.0.0.1:9222';
const PORT = 4321;
const PUBLIC = path.resolve(__dirname, '..', 'public');
const KEYWORD = '\u5f20'; // 张

const log = (...a) => console.log('[smoke]', ...a);

function servePublic() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.join(PUBLIC, url);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

class McpClient {
  constructor(cmd, args) {
    this.nextId = 1;
    this.pending = new Map();
    this.child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.stderrTail = [];
    this.child.stderr.on('data', (d) => {
      this.stderrTail.push(d.toString());
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });
    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      const s = line.trim();
      if (!s) return;
      let msg;
      try { msg = JSON.parse(s); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
    this.child.on('exit', (code) => {
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error(`mcp exited code=${code}`)); }
      this.pending.clear();
    });
  }
  request(method, params = {}, timeoutMs = 90000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(payload);
    });
  }
  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  kill() { try { this.child.kill(); } catch {} }
}

function textOf(result) {
  if (!result) return '';
  const parts = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text);
  return parts.join('\n');
}

function imageOf(result) {
  const item = (result?.content || []).find((c) => c.type === 'image' && c.data);
  return item ? { data: item.data, mimeType: item.mimeType || 'image/png' } : null;
}

function getJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1500, () => { req.destroy(); resolve(null); });
  });
}

const MARKER_URL = 'file:///' + path.join(__dirname, 'marker.html').replace(/\\/g, '/');

function findPageId(pagesText) {
  const m = pagesText.match(/^\s*(\d+):/m);
  return m ? Number(m[1]) : undefined;
}

function findUid(snapshotText, needle) {
  for (const line of snapshotText.split('\n')) {
    const m = line.match(/uid=([\w.:-]+)/);
    if (m && line.toLowerCase().includes(needle.toLowerCase())) return m[1];
  }
  return null;
}

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
  };
  const call = (name, args) => mcp.request('tools/call', { name, arguments: args });

  const outDir = path.resolve(__dirname, 'output', 'sessions', 'poc-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(outDir, { recursive: true });

  const server = await servePublic();
  log(`static server for public/ on http://127.0.0.1:${PORT}`);
  log(`spawning: chrome-devtools-mcp --browserUrl ${BROWSER_URL}`);

  const mcp = new McpClient('cmd', ['/c', 'npx', '-y', 'chrome-devtools-mcp@latest', '--browserUrl', BROWSER_URL]);
  const actions = [];

  try {
    const init = await mcp.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'phase2-smoke', version: '0.1.0' },
    });
    mcp.notify('notifications/initialized', {});
    log(`connected to ${init.serverInfo?.name || 'mcp'} ${init.serverInfo?.version || ''}`);

    const tools = await mcp.request('tools/list', {});
    check('MCP initialize', true, `${(tools.tools || []).length} tools available`);

    // 1. Prove we are attached to OUR Chrome, not a puppeteer-owned one.
    //    Compare what the MCP sees with what our CDP endpoint reports directly.
    const live = await getJson(`${BROWSER_URL}/json/list`);
    const livePage = (live || []).find((p) => p.type === 'page');
    const pagesTxt = textOf(await call('list_pages', {}));
    const pageId = findPageId(pagesTxt);
    const attached = !!livePage && pagesTxt.includes(livePage.url.replace(/\/$/, ''));
    check('attached to Recorder-owned Chrome', attached,
      livePage ? `endpoint page = ${livePage.url}` : 'no page on endpoint');
    check('pageId routing resolved', pageId != null, `pageId=${pageId}`);
    actions.push('list_pages');

    // 2. navigate (via MCP tool)
    const nav = await call('navigate_page', { pageId, url: `http://127.0.0.1:${PORT}/` });
    check('navigate_page', !nav.isError, textOf(nav).split('\n')[0] || '');
    actions.push('navigate_page -> local demo');

    // 3. snapshot -> get uids
    const snapTxt = textOf(await call('take_snapshot', { pageId }));
    const kwUid = findUid(snapTxt, 'textbox') || findUid(snapTxt, '\u5ba2\u6237\u59d3\u540d');
    const searchUid = findUid(snapTxt, '\u67e5\u8be2') || findUid(snapTxt, 'button');
    check('take_snapshot / locate uids', !!kwUid && !!searchUid, `kw=${kwUid} search=${searchUid}`);
    actions.push('take_snapshot');

    // 4. type into input (via MCP fill)
    if (kwUid) {
      const fill = await call('fill', { pageId, uid: kwUid, value: KEYWORD });
      check('fill (type)', !fill.isError, textOf(fill).split('\n')[0] || '');
      actions.push('fill #kw');
    }

    // 5. click search (via MCP click)
    if (searchUid) {
      const click = await call('click', { pageId, uid: searchUid });
      check('click (search)', !click.isError, textOf(click).split('\n')[0] || '');
      actions.push('click #search');
    }

    // 6. scroll + verify page state (via MCP evaluate_script)
    const evalRes = await call('evaluate_script', {
      pageId,
      function: '() => { window.scrollTo(0, 300); return { rows: document.querySelectorAll("tbody tr").length, kw: document.querySelector("#kw").value }; }',
    });
    const evalTxt = textOf(evalRes);
    const filtered = /"rows"\s*:\s*1/.test(evalTxt) || /rows["']?\s*:?\s*1\b/.test(evalTxt);
    check('evaluate_script (scroll + read state)', !evalRes.isError, evalTxt.split('\n').slice(0, 3).join(' '));
    check('filter applied in the real page', filtered, 'expect 1 row for the keyword');
    actions.push('evaluate_script (scroll + verify)');

    // 7. click a result-row action (a second element)
    const snap2 = textOf(await call('take_snapshot', { pageId }));
    const editUid = findUid(snap2, '\u7f16\u8f91');
    if (editUid) {
      const click2 = await call('click', { pageId, uid: editUid });
      check('click (row action)', !click2.isError, textOf(click2).split('\n')[0] || '');
      actions.push('click row action');
    } else {
      check('click (row action)', false, 'edit uid not found');
    }

    const modalTxt = textOf(await call('evaluate_script', {
      pageId,
      function: '() => document.querySelector("#mask").classList.contains("show")',
    }));
    check('real DOM reacted (modal opened)', /true/i.test(modalTxt), modalTxt.split('\n')[0] || '');

    // Visual evidence straight from the Recorder-owned Chrome.
    const shot = imageOf(await call('take_screenshot', { pageId }));
    if (shot) {
      const ext = shot.mimeType.includes('jpeg') ? 'jpg' : 'png';
      fs.writeFileSync(path.join(outDir, 'after-mcp-actions.' + ext), Buffer.from(shot.data, 'base64'));
      actions.push('take_screenshot');
      log(`screenshot saved: after-mcp-actions.${ext}`);
    }

    // Return the dedicated browser to its home page so the marker stays visible.
    await call('navigate_page', { pageId, url: MARKER_URL });
    actions.push('navigate_page -> marker (home)');

  } catch (e) {
    check('smoke run completed', false, e.message);
    if (mcp.stderrTail.length) log('mcp stderr tail:\n' + mcp.stderrTail.join(''));
  } finally {
    mcp.kill();
    server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  log('---------------------------------------------');
  log(`result: ${passed}/${results.length} checks passed`);
  log(`actions performed via MCP: ${actions.join(' | ')}`);

  fs.writeFileSync(path.join(outDir, 'poc-result.json'), JSON.stringify({
    kind: 'phase2a-shared-browser-poc',
    browserUrl: BROWSER_URL,
    at: new Date().toISOString(),
    actions,
    checks: results,
  }, null, 2));
  log(`evidence: ${path.join(outDir, 'poc-result.json')}`);

  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
