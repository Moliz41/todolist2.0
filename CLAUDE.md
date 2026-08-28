# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

一个游戏任务栏风格的 To-Do List 单页应用（"QUEST BOARD"）。纯原生 HTML/CSS/JS，无构建步骤、无打包器、无依赖、无 `package.json`。直接双击 `index.html` 以 `file://` 协议打开即可。原始需求意图见 `AGENTS.md`。

## 运行与测试

没有开发服务器，也没有测试运行器。两种工作流：

- **手动**：双击 `index.html`（以 `file://` 打开）。所有持久化使用 `localStorage`，在 `file://` 下 Chrome/Edge/Firefox 均可用。
- **无头浏览器校验**：E2E 测试是临时的 `.cjs` 脚本（存放在系统临时目录，不在仓库内），通过 Chrome DevTools 协议（CDP）WebSocket 驱动 Edge。流程是启动 `msedge.exe --headless=new --remote-debugging-port=<端口>`，连接到页面的 `webSocketDebuggerUrl`，用 `Runtime.evaluate` 执行断言。测试套子形态参考已有的 `*-test.cjs`（端口探测 → `Page.navigate` → `localStorage.setItem` 注入种子 → `Page.reload` → 对 DOM 断言）。截图用 `Page.captureScreenshot`。

单个文件的语法校验：
```bash
node --check js/app.js
node --check js/store.js
```

## 架构

`index.html` 中三个普通 `<script>` 标签按严格顺序加载：`store.js` → `achievements.js` → `app.js`。**加载顺序很关键** —— 后加载的文件依赖前者的全局对象。**不使用 ES Module**，因为 `file://` 下模块的 CORS 会被拦截；全部采用 IIFE + `window.*` 命名空间（`window.Store`、`window.Badges`）。

- **`js/store.js`**（`window.Store`）—— 数据层，最先加载，无依赖。持有 `TASK_TYPES`/`TASK_TYPE_KEYS` 配置、单一 `localStorage` 键 `questBoard.state.v1`、版本化迁移（`MIGRATIONS`）、`loadState`/`saveState`、`normalizeTask`/`normalize` 兜底清洗、`genId`、`escapeHtml`。所有 `localStorage` 访问都包在 try/catch 中；失败时降级为内存态 + 页面顶部警告条，不崩溃。
- **`js/achievements.js`**（`window.Badges`）—— 8 枚徽章，纯逻辑，不碰 DOM。`evaluateBadges(state)` 只返回「本次新解锁」的徽章（已解锁的会被过滤掉）。`oneshot` 是唯一的**触发式**徽章（在 `applyProgress` 内置位），其余为重算式。
- **`js/app.js`**（`App` IIFE）—— 控制器：持有 `state`、缓存 DOM、渲染、绑定事件。

### 核心控制流模式（必须保持）

**单一状态源 + 全量重渲染 + 事件委托。** 每个变更函数都是：修改 `state` → `Store.saveState(state)` → `checkAchievements()` → `render()`。不要手动局部更新 DOM 片段。`render()` 每次都从 `state` 重建头部统计、成就按钮、选项卡和主体。主体内按钮带 `data-action` + `data-id`；在 `el.body` 上挂一个委托监听器，按 `action` 分发。

### 两个不同的「完成」计数器 —— 切勿混淆

这是本代码库最微妙的地方：

- **头部统计「已完成」**（`renderHeader`）：实时计算 `state.tasks.filter(t => t.status === 'completed').length`。它反映**当前**数量，删除/恢复/清空归档时自然同步，无需额外记账。若改成读 `stats.totalCompleted`，会重新引入「删除已归档任务后显示计数不递减」的 bug。
- **`state.stats.totalCompleted`**：**累计、单调递增**的计数器（在 `applyProgress` 与「创建即完成」路径中递增，永不递减）。它存在的唯一作用是作为成就徽章（`first`/`ten`/`fifty`/`hundred`）的判定阈值。删除任务绝不能让它回退 —— 成就一旦解锁即永久保留。

`stats.createdCount` 同理为累计计数（驱动 `builder` 徽章）。

### 完成语义

任务是否完成当且仅当 `status === 'completed'`，**而非** `progress >= target`。`normalizeTask` 有意保留「进度满但未完成」的状态（例如从归档恢复的 8/8 任务）—— 不要把它「修正」为 `progress >= target` 即自动完成，那样会让恢复的任务在刷新后重新归档。只有 `applyProgress`（从 active 状态达到 target）和「创建时起始进度 ≥ target」这两条路径才会置 `status='completed'`。

### 任务模型与分组

`TASK_TYPES` 只剩 `main`/`side`（旧的 `destination` 类型已移除；旧的 destination 类型任务在 `normalizeTask` 中惰性迁移为 `main`）。`destination` 现在是每个任务上的**可选自由文本字段**，以楷体（KaiTi）显示在标题右侧，上限 60 字符。进行中任务按类型分组（按 `TASK_TYPE_KEYS` 顺序）、组内按 `order` 排序渲染；归档区平铺渲染，按 `completedAt` 倒序。

## 与用户的工作约定

用户**一次只审阅一个改动**：实现某个请求的改动 → 验证 → 然后**停下，提醒用户亲自审阅**，等用户给出下一条指令再继续。不要把多个用户建议打包处理，也不要在当前改动确认前就开始下一个改动。每个改动都用无头 Edge 测试（或对琐碎改动用 `node --check`）验证，并报告通过的测试数。

## 约定

- 所有拼入 HTML 的用户输入都必须经 `Store.escapeHtml()`（标题、目的地）—— 模板是字符串拼接。
- 从持久化状态解析数字用 `toNum()`（处理 `null`/`undefined`/`''`/数字字符串）—— 单用 `parseInt` 在旧存档里字符串化的统计值上会出错。
- 新建任务默认目标进度为 `1`（`index.html` 的 `value` 属性与 `openForm` 两处都要保持）。
- 任务卡片的快捷进度按钮恰好三个：`+1`、`完成`、`自定义…`（`+5`/`+10`/`+25%`/`到顶`/`−1` 已按用户要求移除）。
