# PHASE2 — Live Agent Capture

**本轮状态：Phase 2A（Shared Browser PoC）已完成并通过。Task 5 已闭环，STOP POINT = CLOSED。**
事件采集 / 录像 / camera / renderer 一律未开始（等待评审下发 Phase 2B 指令）。

Phase 1（Scripted Cinematic Recorder）已冻结，见 `SOLUTION.md`。

---

## 0. 一句话结论

> **Recorder 自己启动的 Chrome，可以被 `chrome-devtools-mcp` 成功接管并真实操作。**
> 这是 Phase 2 最关键的不确定性假设，现已用真实进程 + 真实 MCP 协议 + 真实 DOM 变更验证通过（11/11 检查项）。

关键修正：任务书 §5 指出了方向 —— 问题不是"Agent 的真实执行无法录制"，而是 **Chrome 的 ownership 不对**。
本轮把 Chrome 的 owner 从 MCP 换成了 Recorder 的 launcher，问题即消失。

---

## 1. 本轮目标（严格按任务书 Task 1–6）

| Task | 内容 | 状态 |
|---|---|---|
| 1 | 冻结 Phase 1（源码/视频/时间线 + 版本锚点 + 回归） | ✅ |
| 2 | 新建 `phase2/`，与 Phase 1 隔离 | ✅ |
| 3 | `phase2/launch-browser.js`：自启 Dedicated Chrome + CDP endpoint | ✅ |
| 4 | 改 OpenCode 的 chrome-devtools MCP 配置，指向我们的 Chrome | ✅（配置已改，生效需重启 OpenCode） |
| 5 | Agent 通过 MCP 操作该浏览器并肉眼确认是同一个浏览器 | ✅（重启后闭环，见 §6.6） |
| 6 | 形成实验报告（本文件） | ✅ |

明确未做（任务书禁止提前做）：events.json / 录像 / camera / zoom / renderer / TTS / rrweb。

---

## 2. 冻结 Phase 1

### 2.1 产物与版本锚点

- Git：本目录原本**不是** Git 仓库，本轮初始化并建立了锚点。
  - 提交：`f8b6ec7  Phase 1 stable: scripted cinematic recorder (HUD + Playwright + ffmpeg)`
  - 标签：`phase1-stable`
  - 分支：`master`（Phase 2 在 `phase2-live-recorder` 分支开发）
- 归档副本（非 Git 场景的兜底）：`archive/phase1-stable/`（含 `src/`、`public/`、`SOLUTION.md`、`package*.json` 及 baseline 视频）
- Baseline 视频：
  - `output/baseline/phase1-ui-demo.mp4`
  - `output/baseline/phase1-ui-demo.timeline.json`

### 2.2 为保护 baseline 而做的唯一 Phase 1 改动

`src/record.js` 原本在每次录制前 `fs.rmSync(output/)` 全量清空，会把 baseline 一起删掉。
因此做了**最小、附加式**修改：清理时跳过 `output/baseline/`。

```js
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
```

除此之外 Phase 1 逻辑**零改动**（未重写 `record.js` / `hud.js` / `steps.js` 的架构，未删 HUD，未抽象框架）。

### 2.3 回归验证

```
> node src/record.js
✔ 视频已生成: G:\cc_demos\ui-recorder-agent\output\ui-demo.mp4  (861 KB)
✔ 时间线:   ...\output\ui-demo.timeline.json

output/        -> baseline, ui-demo.mp4, ui-demo.timeline.json
output/baseline-> phase1-ui-demo.mp4, phase1-ui-demo.timeline.json   （未被清掉）
```

`npm run record` 仍然一条命令可用，baseline 未受影响。

---

## 3. 环境

| 项 | 值 |
|---|---|
| OS | Windows (win32) |
| Node | v24.12.0 |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`（Chrome/152） |
| MCP | `chrome-devtools-mcp@1.9.0`（`npx -y chrome-devtools-mcp@latest`） |
| OpenCode 配置 | `C:\Users\Administrator\.config\opencode\opencode.json` |

---

## 4. 当前架构（Phase 2A 实现范围）

```
phase2/launch-browser.js
        │  spawn (detached)
        ▼
Dedicated Chrome  127.0.0.1:9222   profile=.runtime/chrome-profile   (headed)
        ▲
        │  --browserUrl http://127.0.0.1:9222
        │
chrome-devtools-mcp  ──►  OpenCode Agent
```

- **Chrome 由 Recorder 启动并持有**（符合任务书 §46 Browser ownership 原则）。
- MCP 只做 attach，不再自己 launch（去掉 `--isolated`）。
- 调试端口固定 `9222`：因为 OpenCode 的 MCP 配置是静态的，必须有一个稳定端口。端口+host 在 `launch-browser.js` 顶部集中定义（`DEBUG_PORT` / `DEBUG_HOST`），未散落。
- 安全：`--remote-debugging-address=127.0.0.1`，仅绑定 localhost；独立 profile，不碰日常 Chrome。

---

## 5. 组件

| 文件 | 作用 |
|---|---|
| `phase2/launch-browser.js` | 启/停/查 Dedicated Chrome，输出清晰日志，写 `.runtime/browser.json` |
| `phase2/marker.html` | Dedicated Chrome 的首页，用来肉眼区分"这是我们的浏览器" |
| `phase2/mcp-smoke-test.js` | PoC 验证器：拉起真实 `chrome-devtools-mcp` 接我们的 Chrome，用 MCP over stdio 驱动一串真实操作 |
| `phase2/README.md` | 操作说明 |
| `phase2/output/sessions/<id>/` | PoC 证据（checks + 截图） |

日志样例（`launch-browser.js`）：

```
[browser] chrome:            C:\Program Files\Google\Chrome\Application\chrome.exe
[browser] profile:           G:\cc_demos\ui-recorder-agent\.runtime\chrome-profile
[browser] debugging endpoint http://127.0.0.1:9222 (bound to 127.0.0.1)
[browser] launched pid=36472, waiting for endpoint...
[browser] debugging endpoint ready
[browser]   browser:   Chrome/152.0.7977.84
[browser]   websocket: ws://127.0.0.1:9222/devtools/browser/106b5434-...
```

---

## 6. 实验过程与结果

### 6.1 Task 3 — 启动 Dedicated Chrome

```
> node phase2/launch-browser.js
[browser] debugging endpoint ready
[browser]   browser:   Chrome/152.0.7977.84

> netstat -ano | findstr :9222
  TCP    127.0.0.1:9222    0.0.0.0:0    LISTENING    36472        （仅 localhost）

> node phase2/launch-browser.js --status
[browser] open pages (1):
[browser]   - [PHASE2-DEDICATED-CHROME] file:///G:/.../phase2/marker.html
```

### 6.2 Task 4 — MCP 配置

`opencode.json` 中 `chrome-devtools` 由：

```json
["cmd","/c","npx","-y","chrome-devtools-mcp@latest","--isolated"]
```

改为：

```json
["cmd","/c","npx","-y","chrome-devtools-mcp@latest","--browserUrl","http://127.0.0.1:9222"]
```

备份：`opencode.json.before-phase2.bak`。JSON 校验通过。

### 6.3 Task 5 前置 —— 真实 MCP 接管验证（关键）

`phase2/mcp-smoke-test.js`：spawn 真实 `chrome-devtools-mcp --browserUrl http://127.0.0.1:9222`，走 MCP over stdio（`initialize` → `tools/list` → `tools/call`）。

```
[smoke] connected to chrome_devtools 1.9.0
[smoke] PASS  MCP initialize  - 29 tools available
[smoke] PASS  attached to Recorder-owned Chrome  - endpoint page = file:///G:/.../phase2/marker.html
[smoke] PASS  pageId routing resolved  - pageId=1
[smoke] PASS  navigate_page  - Successfully navigated to http://127.0.0.1:4321/.
[smoke] PASS  take_snapshot / locate uids  - kw=1_15 search=1_22
[smoke] PASS  fill (type)  - Successfully filled out the element
[smoke] PASS  click (search)  - Successfully clicked on the element
[smoke] PASS  evaluate_script (scroll + read state)  - {"rows":1,"kw":"张"}
[smoke] PASS  filter applied in the real page  - expect 1 row for the keyword
[smoke] PASS  click (row action)  - Successfully clicked on the element
[smoke] PASS  real DOM reacted (modal opened)  - true
[smoke] result: 11/11 checks passed
```

覆盖了任务书 §9 要求的动作：打开页面 / 点击 / 输入 / 滚动 / 再点击另一个元素。
且**这些操作不是 steps.js 驱动**，是 smoke 测试直接通过 MCP 协议发起的。

证据：
- `phase2/output/sessions/poc-2026-09-19T02-09-18-345Z/poc-result.json`
- `phase2/output/sessions/poc-2026-09-19T02-09-18-345Z/after-mcp-actions.png`（真实 Chrome 截图：关键字"张"已输入、列表过滤为张三、编辑弹窗已打开）

### 6.4 复现命令

```bash
npm run phase2:browser     # 起 Dedicated Chrome
npm run phase2:smoke       # 真实 MCP 接管并操作
npm run phase2:inspect     # 查看端口与页面
npm run phase2:browser:stop
```

### 6.5 重启前的状态：OpenCode 会话内的 MCP 尚未切到我们的 Chrome

> 已于 OpenCode 完全重启后闭环，见 §6.6。此处保留作为问题记录。

实测：修改配置后，**当前这个 OpenCode 会话**里的 `chrome-devtools` 工具仍然指向它自己 launch 的 puppeteer 浏览器（`%TEMP%\puppeteer_dev_chrome_profile-*`），不是我们的 Chrome：

```
（会话内工具）list_pages -> 2: about:blank
（我们的浏览器）--status  -> 1: PHASE2-DEDICATED-CHROME  file:///.../marker.html
```

原因：MCP server 由 OpenCode 在启动时拉起，**配置改动需要重启 OpenCode 才会生效**；当前会话无法自我重启。

结论：
- **能力已证明**（§6.3：真实 MCP 进程确实能接管并操作我们的 Chrome）；
- **会话内的 OpenCode 工具切换**需要重启 OpenCode 后复测（见 §9 下一步）。

---

### 6.6 Task 5 闭环复测（OpenCode 重启后）

完全重启 OpenCode 后，**会话内的 chrome-devtools MCP** 已切到 Recorder-owned Chrome，本轮由 Agent 亲手通过 MCP 完成动作链：

```
（会话内工具）list_pages -> 1: PHASE2-DEDICATED-CHROME (file:///.../phase2/marker.html)   ← 我们的 Chrome
（我们的 Chrome）9222 /json/list -> [客户管理系统] file:///.../public/index.html          ← 同一浏览器
（已无 puppeteer_dev_chrome_profile-* 进程）                                              ← MCP 不再自启
```

| 动作 | 目标 | 结果 | 证据 |
|---|---|---|---|
| navigate | `phase2/marker.html` | PASS | snapshot `RootWebArea "PHASE2-DEDICATED-CHROME"` |
| click | marker `#probe` | PASS | 按钮文案变为「已被点击 ✓」 |
| navigate | `public/index.html` | PASS | — |
| fill | `#kw` | PASS | `value="张"` |
| click | `#search` | PASS | 表格由 5 行过滤为 1 行（张三） |
| scroll | window | PASS | `scrollY 0 → 73.71`（viewport 241 / doc 315） |
| click | 行内「编辑」 | PASS | `#mask.show = true` |

最终 DOM：`{ modalOpen: true, modalName: "张三", kw: "张", rows: 1 }`
证据文件：`phase2/output/sessions/task5-live/verification.json`、`final-dom.png`

**Task 5 = PASS，Phase 2A STOP POINT = CLOSED。**

---

## 7. 输出位置

```
phase2/output/sessions/poc-<timestamp>/
  ├─ poc-result.json          # 11 项检查 + 动作清单 + browserUrl
  └─ after-mcp-actions.png    # 我们的 Chrome 被 MCP 操作后的截图
```

（本轮只有 PoC 证据；`session.json` / `events.jsonl` / `raw.webm` / `camera.json` / `final.mp4` 属后续阶段，未创建。）

---

## 8. 文件变化

**新增**
```
phase2/launch-browser.js        # Dedicated Chrome 启停/查询
phase2/marker.html              # 专用浏览器首页
phase2/mcp-smoke-test.js        # MCP 接管 PoC 验证器
phase2/README.md                # 操作说明
phase2/output/sessions/...      # PoC 证据
PHASE2.md                       # 本报告
archive/phase1-stable/          # Phase 1 归档副本
output/baseline/                # Phase 1 baseline 视频
.gitignore                      # 新增（忽略 node_modules/.video/.runtime）
```

**修改**
```
src/record.js                   # 唯一改动：清理 output 时跳过 baseline（保护 Phase 1 成果）
package.json                    # 新增 phase2:* scripts（Phase 1 的 record/convert 不变）
SOLUTION.md                     # 顶部加 3 行状态说明（见文末）
C:\Users\Administrator\.config\opencode\opencode.json   # chrome-devtools 改为 --browserUrl（已备份）
```

---

## 9. 下一步（待评审后决定）

原阻塞点（会话内 MCP 未切到我们的 Chrome）**已通过完全重启 OpenCode 解决**，Task 5 已闭环（§6.6）。

1. 进入 **Phase 2B — Event Capture**（真实 click/input/scroll/navigation → `events.jsonl`），
   注意任务书 §14 的隐私要求（password/敏感字段一律 masked）。
2. 使用前提不变：先 `npm run phase2:browser`，再让 Agent 工作。

可选增强（本轮已发现、但未启用）：
- `chrome-devtools-mcp` 自带 `--experimentalScreencast`（需 ffmpeg），可作为 Phase 2C raw video 的一条现成路径；我们已有 `ffmpeg-static`。

---

## 10. 已知问题

| # | 问题 | 影响 | 处理 |
|---|---|---|---|
| I1 | ~~会话内 MCP 未生效，需重启 OpenCode~~ | 已解决 | 完全重启 OpenCode 后 MCP 以 `--browserUrl` 接管，Task 5 闭环（§6.6） |
| I2 | MCP 默认 `--pageIdRouting`，页面级工具必须带 `pageId` | 编写客户端时需先从 `list_pages` 取 id | 已在 smoke test 处理 |
| I3 | 调试端口固定 9222 | 与用户本地已占用的 9222 冲突 | 单点常量集中定义，必要时改这里+MCP 配置 |
| I4 | 若 launcher 未启动，MCP 因连不上 `--browserUrl` 会启动失败 | 影响该 MCP 可用性 | 使用前先 `npm run phase2:browser` |

---

## 附：任务书 §56 要求的首次汇报

**A. Phase 1**
- 是否已冻结：是。Git tag `phase1-stable`，commit `f8b6ec7`；归档 `archive/phase1-stable/`
- baseline 路径：`output/baseline/phase1-ui-demo.mp4`
- `npm run record` 回归：通过（861 KB，baseline 未被清）

**B. Phase 2 PoC**
- Chrome launcher：`phase2/launch-browser.js`（headed，独立 profile）
- debug endpoint：`http://127.0.0.1:9222`（仅 localhost）
- MCP 配置：`chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9222`
- 测试动作：list_pages / navigate / snapshot / fill / click / evaluate(scroll) / click / screenshot
- 结果：真实 MCP 成功接管并操作我们的 Chrome，11/11 检查通过

**C. 文件变化**：见 §8

**D. 证据**：见 §6.3 / §7（含真实截图）

**E. 风险**：~~I1（需重启 OpenCode）~~ 已解决；I4（launcher 未启动则 MCP 连不上）仍有效

**F. 下一步建议**：Task 5 已闭环（§6.6），可进入 Phase 2B Event Capture（待评审下发指令）
