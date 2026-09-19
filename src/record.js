const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const steps = require('./steps');
const { toMp4 } = require('./to-mp4');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'output');
const TMP = path.join(ROOT, '.video');
const PORT = 4318;
const VIEW = { width: 1280, height: 800 };
const OUT_NAME = process.env.OUT_NAME || 'ui-demo';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.join(PUBLIC, url);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

// Phase 1 outputs are cleaned before every run, but the frozen baseline
// (output/baseline) must never be destroyed by a re-record.
function cleanOutput() {
  if (fs.existsSync(OUT)) {
    for (const entry of fs.readdirSync(OUT)) {
      if (entry === 'baseline') continue;
      fs.rmSync(path.join(OUT, entry), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
}

async function main() {
  cleanOutput();
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP, size: VIEW },
  });
  const page = await context.newPage();
  await page.addInitScript({ path: path.join(__dirname, 'hud.js') });

  const hud = {
    caption: (s, t, ti, d) => page.evaluate((a) => window.__hud.caption(...a), [s, t, ti, d]),
    hideCaption: () => page.evaluate(() => window.__hud.hideCaption()),
    move: (x, y) => page.evaluate((a) => window.__hud.moveCursor(...a), [x, y]),
    hl: (rect, tip) => page.evaluate((a) => window.__hud.highlight(...a), [rect, tip]),
    hlOff: () => page.evaluate(() => window.__hud.clearHighlight()),
    ripple: (x, y) => page.evaluate((a) => window.__hud.ripple(...a), [x, y]),
    card: (a, b) => page.evaluate((p) => window.__hud.card(...p), [a, b]),
    cardOff: () => page.evaluate(() => window.__hud.hideCard()),
  };

  async function center(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('element has no box: ' + locator);
    return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async function moveTo(locator) {
    const c = await center(locator);
    await hud.move(c.x, c.y);
    await sleep(560);
    return c;
  }
  async function highlight(locator, tip) {
    const { box } = await center(locator);
    await hud.hl({ x: box.x, y: box.y, width: box.width, height: box.height }, tip || '');
    await sleep(320);
  }
  async function click(locator, tip) {
    const c = await moveTo(locator);
    await hud.ripple(c.x, c.y);
    await highlight(locator, tip);
    await sleep(220);
    await locator.click();
    await sleep(200);
    await hud.hlOff();
  }
  async function type(locator, text, tip) {
    await moveTo(locator);
    await highlight(locator, tip);
    await locator.click();
    await locator.pressSequentially(text, { delay: 150 });
    await sleep(260);
    await hud.hlOff();
  }
  async function select(locator, value, tip) {
    await moveTo(locator);
    await highlight(locator, tip);
    await locator.selectOption(value);
    await sleep(260);
    await hud.hlOff();
  }

  const startedAt = Date.now();
  const timeline = [];
  const ctx = { page, sleep, moveTo, highlight, clearHighlight: hud.hlOff, click, type, select, hud };

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await sleep(500);
  await hud.card('客户管理系统', '操作演示 · UI Recorder Agent');
  await sleep(1700);
  await hud.cardOff();
  await sleep(400);

  const total = steps.length;
  for (let i = 0; i < total; i++) {
    const s = steps[i];
    const t0 = Date.now() - startedAt;
    await hud.caption(i + 1, total, s.title, s.detail);
    await sleep(450);
    await s.run(ctx);
    timeline.push({ step: i + 1, title: s.title, detail: s.detail, atMs: t0, endMs: Date.now() - startedAt });
    await sleep(280);
  }

  await hud.hideCaption();
  await sleep(300);
  await hud.card('演示结束', '由 UI Recorder Agent 录制');
  await sleep(1900);

  const video = page.video();
  await context.close();
  await browser.close();
  server.close();

  const webm = await video.path();
  const mp4 = path.join(OUT, OUT_NAME + '.mp4');
  await toMp4(webm, mp4);
  fs.writeFileSync(path.join(OUT, OUT_NAME + '.timeline.json'),
    JSON.stringify({ output: OUT_NAME + '.mp4', durationMs: Date.now() - startedAt, steps: timeline }, null, 2));

  const kb = (fs.statSync(mp4).size / 1024).toFixed(0);
  console.log(`\n✔ 视频已生成: ${mp4}  (${kb} KB)`);
  console.log(`✔ 时间线:   ${path.join(OUT, OUT_NAME + '.timeline.json')}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
