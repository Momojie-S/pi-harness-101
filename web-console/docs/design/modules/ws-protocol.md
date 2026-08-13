# WS 通信与前端性能方法论

> 角色：**通信架构 + 性能优化的方法论总结**。本文不是 API 清单（消息类型见 `server/types.ts` 的 `ClientMessage`/`ServerMessage`），而是「为什么这么通信」「卡了怎么治」的方法论。
> 关联：整体架构见 [../design.md](../design.md)；相关 ADR：[007](../adr/007-statemanager-usereducer.md)（useReducer）、[017](../adr/017-stream-data-external-store.md)（streamStore）、[018](../adr/018-message-list-virtualization.md)（虚拟列表）。

## 1. 通信架构：单 WebSocket，全双工 JSON

所有前后端通信走**一个 WebSocket 连接**（`/ws`），消息体是 JSON。

```
浏览器 ◄──WSS──► nginx ──► frp 隧道 ──► 本机 Node 进程（ws.ts）
```

**为什么不用 REST + SSE / 轮询？**
- agent 输出是**流式**的（token 级），WS 全双工天然适配（服务端持续推、客户端随时发）。
- REST 轮询延迟高、浪费请求；SSE 只能服务端→客户端单向。

**一个连接够吗？** 够。WS 是全双工的，一个连接可并发收发多条消息，不会因为一个 session 在流式就阻塞另一个操作。性能瓶颈从不在「连接数」，而在**往返次数**和**前端渲染**（见 §3）。

## 2. 三种消息流模式

### 2.1 请求-响应（一问一答）

前端发 `ClientMessage`，后端处理后回 `ServerMessage`。后端**不带回执 ID**——靠消息类型 + 上下文（sessionId / path）关联。

```
前端: { type: "open_session", cwd }          后端: { type: "session_opened", ... }
前端: { type: "read_file", sessionId, path }  后端: { type: "file_content", path, content }
```

> **关键纪律**：一个用户操作尽量只触发**一次**往返。多次串行往返在网络抖动下会叠加延迟（见 §3.1）。

### 2.2 服务器推送（单向）

后端主动推，前端不请求。主要是 agent 执行期间的事件流：

```
后端 → { type: "agent_event", sessionId, event: { type: "message_update", ... } }  // token 级流式
后端 → { type: "context_usage", sessionId, usage }                                   // 每轮结束
后端 → { type: "restarting", sessionId }                                             // 服务重启
```

### 2.3 订阅模式（一个连接，多 session）

一个 WS 连接可同时订阅**多个会话**（多 tab 并行）。后端按 `sessionId` 路由事件：

- `open_session` / `open_history` → 后端 `store.subscribe(sessionId, forwardFn)`，事件转发到该连接。
- `close_session` → `unsubscribe`。
- 断线重连时 `handleConnection` 自动重订阅所有活跃 session（`store.listActive()`）。

## 3. 性能优化方法论（分层）

性能问题分三层，**诊断时必须定位到正确层级**，否则治标不治本：

| 层级 | 症状 | 诊断方法 | 治法 |
|------|------|----------|------|
| **网络** | 点击后等很久才响应 | curl/WS 测往返延迟 | 减少往返次数（§3.1） |
| **渲染** | 界面冻结/掉帧（JS 主线程满） | PerformanceObserver 测 long task | 虚拟列表 + memo（§3.2 §3.3） |
| **交互** | 操作无反馈，以为卡死 | 审计每个操作的 pending 反馈 | 即时反馈（§3.4） |

### 3.1 网络层：减少往返次数

**症状**：操作后等很久才响应，尤其跨公网（frp 隧道）。

**根因**：一次用户操作触发多次串行 WS 往返。每次往返在网络抖动下可能 50-700ms，N 次叠加。

**治法**：**后端预取**——一次请求带回所有需要的数据。

> **案例**：新建会话原来要 3 次往返（`open_session` → 补发 `list_dir` → 补发 `list_commands`）。改为后端在 `session_opened` 里直接预取根目录 + 命令带回（`buildSessionOpened`），降到 1 次。frp 抖动下从「可能 2 秒」降到「75ms」。

**原则**：前端收到一个响应后，如果还要补发 2 个请求才能完整渲染，就该让后端在第一个响应里一次性带齐。

### 3.2 渲染层①：高频更新绕开全局 state

**症状**：agent 流式输出时，整个界面卡（点目录树、切会话都没反应）。

**根因**：全局 `useReducer` 每次返回新顶层 state → 整棵组件树重渲染。LLM token 级更新（每秒数十次）如果进 reducer，会让**所有**组件跟着重渲染。

**治法**：高频更新源（`streamText`、工具流式 `output`）移到独立的 `useSyncExternalStore` 外部 store（[ADR-017](../adr/017-stream-data-external-store.md)），按 sessionId 细粒度订阅——只有真正读取该数据的组件重渲染。

> **数据流变更**：`message_update`（token）→ 不 dispatch，直接写 `streamStore` → 仅 ChatPanel 流式区更新。

### 3.3 渲染层②：虚拟列表 + memo

**症状 A**：reducer 更新时，已有的几百条消息全部重新 markdown 解析。

**治法 A**：`React.memo` + `useCallback`。消息对象在 reducer 里保持引用稳定（`[...messages, new]` 展开保留旧引用），memo 后旧消息跳过重渲染。

**症状 B**：切换会话 / 首屏加载时，几百条消息**首次**渲染慢（memo 对首次无效，message 变了必须渲染）。手机 CPU 弱 3-5 倍，470 条 markdown 桌面 928ms → 手机 3-5 秒。

**治法 B**：虚拟列表（[ADR-018](../adr/018-message-list-virtualization.md)，react-virtuoso）。只渲染可见的 ~20 条，而非全部。470 条消息渲染从 928ms 降到 0ms（实测）。

### 3.4 交互层：即时反馈

**症状**：操作后界面无变化，用户以为「卡死」或「没点中」，反复点击。

**根因**：异步操作（发 WS 等响应）期间无视觉反馈。

**治法**：每个异步操作都要有 **pending 状态** + **可见反馈**：
- 新建/打开会话 → 全局遮罩「正在打开会话…」（`openingSession` 期间拦截所有点击，防乱点）。
- 打开文件 → FileViewer 立即弹 loading（`pendingFile`），内容到达后填充。
- 发送消息 → 乐观追加用户消息（不等后端确认）。

> **纪律**（AGENTS.md）：用户触发的每个操作都必须有可见反馈，成功和失败都要。

## 4. 诊断工具箱

| 怀疑的层 | 工具 | 怎么用 |
|----------|------|--------|
| 网络延迟 | `curl -w "%{time_*}"` / WS 往返计时 | 测单次往返，看是否抖动（jitter）|
| 前端渲染 | `PerformanceObserver({entryTypes:['longtask']})` | 统计 >50ms 的主线程任务 |
| DOM 规模 | `document.querySelectorAll('*').length` | 判断挂载了多少节点（虚拟列表前 4000+，后 ~100）|
| 代码版本 | `script[src*="index-"]` 的 hash | 确认用户加载的是否最新（优化没生效常因没刷新）|

**诊断顺序**：先确认代码版本（是不是没刷新）→ 测网络往返（是不是抖动）→ 测 long task（是不是渲染）→ 审计交互反馈（是不是无反馈的错觉）。

## 5. 消息契约索引

完整类型见 `server/types.ts`，此处只列分类：

- **会话生命周期**：`open_session`→`session_opened`(含预取 dirContent+commands)、`close_session`→`session_closed`、`open_history`、`list_sessions`→`sessions_list`
- **对话**：`prompt`/`steer`/`follow_up`/`abort` → `agent_event`(流式) → `context_usage`
- **文件/目录**：`read_file`→`file_content`、`list_dir`→`dir_content`、`browse_dir`→`browse_result`
- **配置**：`list_models`/`set_model`→`model_changed`、`set_thinking`、`compact`、`reload_session`→`reloaded`
- **会话树**：`list_entries`→`entries_tree`、`navigate`、`fork`
- **分页**：`load_earlier`→`earlier_messages`
- **系统**：`sessions_active`(重连恢复)、`restarting`、`error`、`ui_notify`/`ui_set_status`(扩展 UI 桥接)
