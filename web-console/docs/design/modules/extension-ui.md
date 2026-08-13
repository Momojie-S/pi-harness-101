# 扩展 UIContext 桥接（ctx.ui → web-console 前端）

> 角色：**功能设计文档**。记录 web-console 如何把 pi 扩展的 `ctx.ui.*` 调用桥接到 Web 前端。
> 关联：整体架构见 [../design.md](../design.md)；WS 消息契约见 `server/types.ts`（`ui_notify`）；注入点见 `server/session-store.ts` `initSession`。

## 1. 背景与问题

pi 扩展通过 `ctx.ui.*` 与用户交互（`notify` / `select` / `confirm` / `setStatus` / `setWidget` 等）。这套接口是为 TUI 设计的——pi 进程内有一个真实的终端 UI。

web-console 用 SDK 模式（`createAgentSession`）跑 pi 会话，**没有终端 UI**。`createAgentSession` 默认注入 `noOpUIContext`（所有方法空操作），导致：

- `ctx.hasUI` 为 `false`（`hasUI() = uiContext !== noOpUIContext`）
- 扩展的 `ctx.ui.notify(...)` 被吞掉（noOp），用户在 Web 界面**完全看不到**
- 扩展开发者不得不写 `if (ctx.hasUI) ctx.ui.notify(...) else console.log(...)` 的降级——但 console.log 在后端终端，Web 用户仍看不到

**这不是单个扩展的问题，是 web-console 的基础设施缺口**：所有扩展的 UI 反馈在 web-console 下都失效。

## 2. 设计：注入最小 UIContext，桥接到 WS

web-console 在 `createAgentSession` 后调 `session.bindExtensions({ uiContext, mode })` 注入一个自实现的 UIContext：

- **`notify(message, level)`**：转发成 WS 消息 `ui_notify` → 前端渲染（`info`→system-notice 绿；`warning`/`error`→system-error 红）
- **其余方法暂为 no-op**（见 §4 后续路线）

`mode` 设为 `"rpc"`（非 `"tui"`）——扩展用 `ctx.mode === "tui"` 守护终端专用 UI（自定义组件等），web-console 不是终端，不该触发那些分支。

### 为什么用 `bindExtensions` 而非 createAgentSession options

`createAgentSession`（SDK 入口 `core/sdk.js`）的 options **不支持 uiContext**（不在 options 类型里）。`uiContext` 是 `ExtensionBindings` 的字段，通过 `AgentSession.bindExtensions(bindings)` 注入。

`bindExtensions` **可安全重复调用**（只覆盖字段 + `_applyExtensionBindings(runner)` 应用到现有 runner，不重建 runner、不重复 bind）。createAgentSession 内部已用 noOp bind 过一次，web-console 再 bind 一次覆盖即可。

### 广播机制

`ui_notify` 要推给该会话的所有订阅者（多端可能同时看一个会话）。`webConsoleUIContext` 闭包捕获 `managed.subscribers`（Set），notify 时遍历广播——和 `session.subscribe` 的 agent_event 广播同一套机制。

**session_start 期间的缓冲**：`session_start` 在 `createAgentSession` 内部触发，**早于** WebSocket 客户端重连订阅。此时 `subscribers` 为空，notify 广播无人接收。修复：`managed.pendingNotices` 缓冲区——subs=0 时 notify 消息先进缓冲，客户端 `subscribe()` 时 flush（遍历缓冲发给新订阅者后清空）。

## 3. 当前实现（MVP）

| ExtensionUIContext 方法 | 状态 | 说明 |
|---|---|---|
| `notify(msg, level)` | ✅ **已桥接** | → `ui_notify` WS 消息 → 前端 system-notice/error |
| `setStatus(key, text)` | ✅ **已桥接** | → `ui_set_status` WS 消息 → 前端状态栏 chip（key→text，undefined 清除） |
| `select` / `confirm` / `input` | ⏳ no-op | 返回 undefined/false（扩展会降级处理） |
| `setStatus` / `setWidget` | ⏳ no-op | footer/widget 无对应（web-console 布局不同） |
| `setWorkingMessage` / `setWorkingVisible` / `setWorkingIndicator` | ⏳ no-op | streaming 指示器（web-console 有自己的 streaming UI） |
| `onTerminalInput` | ⏳ no-op | 终端原始输入（web-console 无终端） |
| `custom` / `editor` / `setEditorText` | ⏳ no-op | TUI 自定义组件/编辑器 |

注入点：`server/session-store.ts` `initSession()`，createAgentSession 之后、`this.sessions.set` 之前。

## 4. 后续路线（按需支持）

优先级取决于实际需求（哪个扩展需要哪个方法）：

1. **~~`setStatus(key, text)`~~** ✅ 已实现：扩展设置状态栏文本（如 goal 显示"⊙ 进行中 3/20"）。前端状态栏用 `flex-wrap` 布局，chip 自动换行适配移动端。
2. **`confirm(title, msg)`**：扩展弹确认框（如 destructive 操作确认）。需前端加模态对话框 + `ui_confirm` 请求/响应往返（异步，扩展 await 用户选择）。
3. **`select(title, options)`**：扩展弹选择器。同 confirm，需请求/响应往返。
4. **`setWidget(key, content)`**：扩展在编辑器上方/下方放 widget（如 todo 列表）。需前端加 widget 渲染区域。

**异步交互方法（confirm/select/input）的特殊性**：它们是 `Promise`，扩展 `await` 用户操作。桥接需要 WS 请求/响应往返（前端弹框 → 用户选择 → WS 回传 → resolve Promise）。比 notify（单向推送）复杂，需专门的请求 ID 关联机制。

## 5. 已知限制

- **no-op 方法静默丢弃**：扩展调 `setStatus` 等当前无效果，且无警告。扩展若依赖这些方法做关键交互会失效（但 `hasUI=true` 让扩展以为 UI 可用，可能不降级）。后续按需实现，或对未实现的方法打 warning 日志。
- **`mode="rpc"` 的副作用**：扩展用 `ctx.mode === "tui"` 守护的分支在 web-console 不触发。这是期望行为（web-console 非终端），但意味着为 TUI 写的自定义组件在 web-console 不显示。
