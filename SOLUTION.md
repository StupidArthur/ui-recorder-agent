> Status: Phase 1 Stable
>
> 本文件描述 Scripted Cinematic Recorder（脚本化流程 → 带 HUD 的视频）。
> Live Agent Capture 的后续设计与实验见 `PHASE2.md`。

# UI Recorder Agent — 录制/回放方案设计（v0.1，待评审）

## 1. 文档目的

本文描述当前已跑通的"浏览器操作录制 → 本地视频回放"方案，供评审。目标是让评审人只读本文即可判断：
- 需求是否被正确理解；
- 技术路线是否成立；
- 已交付的能力边界；
- 风险、限制与需要拍板的决策点。

当前状态：**最小可用链路已跑通并产出成品视频**（`output/ui-demo.mp4`，24.8s / 1280×800 / H.264）。

---

## 2. 需求与约束

### 2.1 用户原始诉求
1. 让 Agent 操作浏览器；操作过程要**录制**下来。
2. 产物可以在**本地回放**。
3. 底线是**视频**；希望"看得到操作逻辑、操作重点"，观感要"比较高端"。
4. **不要**以"可回放脚本"作为最终交付形态。
5. 第一步先把链路跑通，再决定后续形态。

### 2.2 由此推导出的设计目标
| 编号 | 目标 | 对应实现 |
|---|---|---|
| G1 | 输出通用视频文件，本地双击可播 | H.264 MP4（yuv420p，faststart） |
| G2 | 明确展示"现在在做什么" | 底部步骤字幕条（标题 + 说明 + 序号） |
| G3 | 明确展示"重点是什么" | 目标元素高亮环 + 操作提示气泡 |
| G4 | 让操作过程可感知（不是截图拼贴） | 平滑移动的鼠标光标、点击波纹、真实交互反馈 |
| G5 | 观感统一、有头有尾 | 片头标题卡、片尾卡、进度条 |
| G6 | 流程可替换、可复现 | 步骤脚本与录制引擎分离（`steps.js` / `record.js`） |

---

## 3. 关键技术发现（决定了方案选型）

### 3.1 MCP 浏览器无法被外部录制
本环境中的 Chrome DevTools MCP 所控制的 Chrome 进程（PID 39096）启动参数为：

```
--remote-debugging-pipe --user-data-dir=...\puppeteer_dev_chrome_profile-17JHh4
```

`--remote-debugging-pipe` 表示调试信道走**匿名管道**，**不监听 TCP 端口**。因此：
- 无法从外部通过 CDP 接入该实例；
- 无法对它调用 `Page.startScreencast`（CDP 录屏）；
- 本机唯一监听中的调试端口 `127.0.0.1:9234` 属于宿主 App（Electron），不是目标浏览器。

**结论**：想录制"Agent 通过 MCP 操作的现场"，MCP 侧没有可用抓手。

### 3.2 备选路线对比
| 方案 | 原理 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A. 截 MCP 浏览器 CDP 录屏 | `Page.startScreencast` | 录到真实 Agent 操作 | **不可行**（见 3.1） | 淘汰 |
| B. 桌面整屏录屏 | ffmpeg `gdigrab` | 能录到任意窗口 | 需装 ffmpeg；画面含无关窗口；窗口位置/遮挡不可控；分辨率不干净 | 备选（兜底） |
| C. rrweb DOM 录制 | 注入 rrweb 记录 DOM 变更 | 高保真、可交互回放 | 产物是回放页不是视频；跨域 iframe 有坑；转视频复杂 | 备选（进阶） |
| D. **Playwright 驱动 + 页面内注入 HUD** | 自建 Chrome 实例，Playwright 录像 | 画面纯净可控、动效可编程、链路最短、产物即视频 | 操作由脚本发起，非"手把手"实时 | **采用** |

选择了方案 D，理由：在"底线是视频 + 要高观感 + 先跑通"三个条件下，它是唯一同时满足可控性、画质与工程成本的路线。

---

## 4. 方案总览

### 4.1 架构

```
┌──────────────────────────────────────────────────────────────┐
│                       record.js（编排与录制引擎）              │
│  - 起本地静态服务器 public/                                     │
│  - 启动系统 Chrome（channel: chrome，1280×800）                │
│  - addInitScript 注入 hud.js（每个页面/帧自动生效）             │
│  - 建 Context 并开启 recordVideo                              │
│  - 逐条执行 steps.js：先更新字幕 → 再执行动作                   │
│  - 片头/片尾卡 → 关闭 Context 落地 webm → 转 mp4               │
│  - 落盘 timeline.json                                          │
└───────────────┬───────────────────────────┬──────────────────┘
                │ 驱动                        │ 控制 HUD
                ▼                             ▼
      ┌───────────────────┐        ┌──────────────────────────┐
      │ 真实页面（Chrome） │◀──────▶│ window.__hud（页面内 DOM）│
      │ public/index.html │  注入   │ 字幕/光标/高亮/波纹/卡片   │
      └───────────────────┘        └──────────────────────────┘
                │ Playwright 原生录像（webm）
                ▼
        ┌───────────────┐    ffmpeg-static    ┌──────────────┐
        │  .video/*.webm │ ─────────────────▶  │ output/*.mp4 │
        └───────────────┘   H.264 + faststart  └──────────────┘
```

**核心设计思想**：把"字幕、光标、高亮、波纹"做成**页面内的 DOM 层（HUD）**，而不是后期用 ffmpeg 叠加。
好处：Playwright 的原生录像会**连同 HUD 一起录进去**，无需做时间轴对齐、无需额外的视频合成工具链，动效直接用 CSS 写，观感更细腻。

### 4.2 目录结构

```
ui-recorder-agent/
├─ package.json          # 依赖与脚本
├─ public/
│  └─ index.html         # 演示站点：客户管理系统（纯本地、零外部依赖）
├─ src/
│  ├─ hud.js             # 注入页面的录制 HUD（字幕/光标/高亮/波纹/卡片）
│  ├─ steps.js           # 步骤脚本（流程定义，唯一需要按业务修改的文件）
│  ├─ record.js          # 录制引擎（编排、录像、导出）
│  └─ to-mp4.js          # webm → mp4 转码（ffmpeg-static）
└─ output/               # 产物（每次录制前清空重建）
   ├─ ui-demo.mp4
   └─ ui-demo.timeline.json
```

---

## 5. 组件详解

### 5.1 演示站点 `public/index.html`
- 单文件、纯静态、无网络依赖，保证录制可离线、可复现。
- 业务：客户管理系统的查询 → 选择 → 编辑 → 保存 → 反馈闭环，足够覆盖常见交互类型（输入 / 下拉 / 按钮 / 弹窗 / 提示）。
- 提供稳定选择器（`#kw` `#search` `#m-status` `#m-save`、`tbody button.link` 等），便于步骤脚本定位。

### 5.2 HUD 注入层 `src/hud.js`
- 通过 `page.addInitScript()` 在**每个新文档创建前**注入，页面跳转后依然生效。
- 自建根节点 `.__hud-root`，`pointer-events:none`，`z-index` 极高，不干扰页面交互。
- 对外 API（挂在 `window.__hud`）：

| API | 作用 |
|---|---|
| `caption(step, total, title, detail)` | 显示/更新底部字幕条、推进进度条 |
| `hideCaption()` | 隐藏字幕条 |
| `moveCursor(x, y)` | 光标 + 光晕平滑位移（CSS `transition`，缓动 `cubic-bezier(.22,.61,.36,1)`） |
| `highlight(rect, tip)` | 在元素外框画脉冲高亮环，并弹出操作提示气泡 |
| `clearHighlight()` | 收起高亮环与气泡 |
| `ripple(x, y)` | 点击点扩散波纹 |
| `card(big, sm)` / `hideCard()` | 片头/片尾全屏标题卡 |

设计要点：
- 光标用 SVG 箭头 + `drop-shadow`，比"圆点"更像真实鼠标，观感更"高端"。
- 高亮环用 `box-shadow` + `@keyframes` 做脉冲呼吸，提示"当前操作重点"。
- 所有动效是纯 CSS 过渡/动画，录制时由 Playwright 的合成器逐帧抓取，无需 JS 逐帧驱动。

### 5.3 步骤脚本 DSL `src/steps.js`
流程定义与引擎解耦。每一步是一个对象：

```js
{
  title:  '选择目标客户',                              // 字幕主标题
  detail: '定位到客户「张三」，点击行末的编辑操作',    // 字幕副说明
  async run(ctx) {
    await ctx.click(
      ctx.page.locator('tbody tr', { hasText: '张三' }).locator('button.link'),
      '编辑该客户'                                       // 高亮气泡文案
    );
  }
}
```

`ctx` 提供的高阶动作（内建"移动光标 → 高亮 → 执行 → 收起高亮"的标准节奏）：

| 动作 | 语义 |
|---|---|
| `moveTo(locator)` | 滚动到可见 → 取包围盒 → 光标平滑移入，等待动画完成 |
| `highlight(locator, tip)` | 高亮目标 + 气泡 |
| `clearHighlight()` | 收起高亮 |
| `click(locator, tip)` | 移动 → 波纹 → 高亮 → 真实点击 |
| `type(locator, text, tip)` | 高亮 → 聚焦 → **逐字符**输入（`pressSequentially`，`delay:150ms`） |
| `select(locator, value, tip)` | 高亮 → 选择下拉项 |
| `page` / `sleep(ms)` / `hud` | 逃生通道：直接用 Playwright / 直接调 HUD |

**替换流程只需改 `steps.js`，引擎无需改动。**

### 5.4 录制引擎 `src/record.js`
1. 清空并重建 `output/`、`.video/`。
2. 起本地静态服务器（`127.0.0.1:4318`，仅服务 `public/`，带路径穿越防护）。
3. `chromium.launch({ channel: 'chrome' })` —— 复用系统已装 Chrome，**无需下载 Playwright 自带浏览器**。
4. `newContext({ viewport:1280×800, deviceScaleFactor:1, recordVideo })`。
5. `addInitScript({ path: hud.js })`。
6. 播放片头卡 → 逐条跑步骤（**先字幕、后动作**，保证每一帧都有上下文）→ 片尾卡。
7. 关闭 Context 落地 webm → 调 `to-mp4.js` 转码 → 落 `timeline.json`。

### 5.5 转码 `src/to-mp4.js`
- 使用 `ffmpeg-static` 自带二进制（跨机器无需预装 ffmpeg）。
- 首选：`libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart`。
- 失败自动回退：`mpeg4 -q:v 3`。
- `yuv420p` + `faststart` 保证 Windows 播放器 / 微信 / 网页都能直接播。

---

## 6. 运行方式

```bash
npm install          # 安装 playwright + ffmpeg-static
npm run record       # 录制并导出 output/ui-demo.mp4
npm run convert      # 单独转码：node src/to-mp4.js <in.webm> <out.mp4>
OUT_NAME=xxx         # 环境变量自定义输出文件名
```

---

## 7. 产物

### 7.1 `output/ui-demo.mp4`
- 1280×800，H.264 High，yuv420p，25fps，约 25s，~800KB。
- 内容：片头卡 → 7 个操作步骤（含字幕、光标、高亮、波纹）→ 片尾卡。

### 7.2 `output/ui-demo.timeline.json`
每步的文案与时间刻度，便于后续做章节、配音、二次剪辑：

```json
{
  "output": "ui-demo.mp4",
  "durationMs": 27450,
  "steps": [
    { "step": 1, "title": "打开客户列表", "detail": "进入系统首页，加载全部客户数据", "atMs": 3166, "endMs": 4500 },
    { "step": 4, "title": "选择目标客户", "detail": "定位到客户「张三」，点击行末的编辑操作", "atMs": 10651, "endMs": 13337 }
  ]
}
```

> 注：`durationMs` 为引擎侧墙钟耗时（含片头/片尾卡等待），与视频实际时长（约 24.8s）存在约 2~3s 偏差——录像在页面就绪后才开始，收尾时片尾卡仍在淡出即关闭 Context。若需精确对齐后期，应以视频时长为基准重新标定。

---

## 8. 验收结果（已实测）

- [x] 一条命令产出可本地播放的 mp4
- [x] 视频含操作逻辑（字幕条"4/7 选择目标客户 / 定位到客户「张三」…"）
- [x] 视频含操作重点（编辑按钮蓝色脉冲高亮环 + 气泡"编辑该客户"）
- [x] 光标平滑移动、点击有波纹
- [x] 真实业务反馈被录到（保存成功 toast、列表状态由"正常"变为"待审核"）
- [x] 片头/片尾卡 + 底部进度条
- [x] 流程定义与引擎解耦，改 `steps.js` 即可换流程

---

## 9. 已知限制与风险

| 编号 | 限制 | 影响 | 缓解/后续 |
|---|---|---|---|
| L1 | 操作由脚本发起，非 Agent 实时手工点击 | 与"Agent 边想边操作"的场景有出入 | 见 §10 决策点 D1 |
| L2 | 未做窗口/页面滚动时的坐标处理特例 | 超长页面滚动后光标坐标依赖 `scrollIntoViewIfNeeded` 后取盒 | 已内置 `scrollIntoViewIfNeeded`，暂未见问题 |
| L3 | 未处理弹窗/多标签/新窗口/iframe | 复杂站点可能失效 | 后续加 `frame` 上下文与 `popup` 处理 |
| L4 | 无音轨、无配音 | 演示片可能不够"完整" | 后续可加 TTS 旁白（§11） |
| L5 | 视频无局部放大 | 小元素看不够清楚 | 后续加"放大镜"效果（§11） |
| L6 | 依赖系统已安装 Chrome | 换机器需有 Chrome | 可改为下载 Playwright 自带 chromium |
| L7 | 站点为自建演示页 | 尚未在真实网站验证 | 见 §10 决策点 D2 |

---

## 10. 待评审决策点

**D1：录制对象到底是什么？**
- (a) 当前方案：脚本化流程录制（稳定、画质好、可复现）；
- (b) Agent 通过 MCP 实时操作的现场录制 —— 需退到方案 B（桌面录屏）或方案 C（rrweb）。
- → 请明确"录的是演示片，还是操作实录"。

**D2：目标站点？**
- 继续用本地演示站，还是切到真实 URL（需处理登录态、网络抖动、选择器稳定性）。

**D3：是否需要"可交互回放"（不止视频）？**
- 若要，需并行引入 rrweb 路线。

**D4：交付形态？**
- 一次性视频，还是要沉淀成可复用工具（CLI 输入步骤 JSON 出片）。

---

## 11. 后续演进路线（候选，按价值排序）

1. **章节分段 / 局部放大**：用 timeline.json 驱动，聚焦小元素时做数字变焦。
2. **TTS 旁白 + 字幕音轨**：把 `detail` 直接合成语音，视频自带讲解。
3. **步骤 JSON 化 + CLI**：`ui-recorder steps.json -o out.mp4`，非工程同学可自助出片。
4. **接真实站点**：加登录态复用（`storageState`）、选择器自愈、等待策略。
5. **rrweb 双产物**：同一流程同时产出视频 + 可交互回放页。

---

## 12. 结论

方案以"页面内 HUD + Playwright 原生录像"为核心，用最小工程成本同时满足了"是视频、有逻辑、有重点、观感统一"四项诉求，链路已跑通并可复现。
主要待确认项集中在 §10 的 D1（录演示片还是操作实录）与 D2（目标站点），这两点将决定是否需要在当前方案之外并行引入桌面录屏或 rrweb 路线。
