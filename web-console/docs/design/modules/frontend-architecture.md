# 前端架构

> 角色：**重构依据**。本文是 `src/App.tsx`（当前 487 行上帝组件）拆分的直接依据——重构按本文执行。
> 关联：整体架构见 [../design.md](../design.md)；WS 消息契约（ClientMessage/ServerMessage）见 `server/types.ts`。
> 已过 [ADR-007](../adr/007-statemanager-usereducer.md)（状态管理选型）、[ADR-008](../adr/008-stateref-for-reconnect.md)（重连读快照）评审。

## 1. 现状盘点（App.tsx 当前的全部职责）

### 1.1 State（14 个 useState）

| 类别 | state | 说明 |
|------|-------|------|
| 会话核心 | `sessions` / `sessionOrder` / `activeSessionId` | 多会话（进 reducer） |
| 工作目录 | `dirs` | 可用目录 |
| 输入 | `input` / `cmdIndex` | 输入框 + 补全选中项（**ChatPanel 局部态**，见 §6） |
| 模态 | `fileViewer` / `modelPicker` / `thinkingPicker` / `sessionPicker` / `treePicker` | 5 个弹层 |
| 数据 | `models` / `historySessions` | picker 选项 |
| 错误 | `globalError` | 全局错误 |

### 1.2 Ref（6 个 useRef）

| ref | 用途 | 重构后 |
|-----|------|--------|
| `wsRef` | WebSocket 句柄 | **保留**（非状态） |
| `scrollRef` | 消息区 DOM 滚动 | **保留**（DOM，迁入 ChatPanel） |
| `activeSessionIdRef` / `sessionOrderRef` / `sessionsRef` | 镜像 state 供 WS 回调读最新值 | **删除**，收敛为 1 个 `stateRef`（见 §4.1 + ADR-008） |
| `toolArgsRef` | ~~工具参数缓存~~ | **删除（死代码）**：写入后从未读取（`tool_execution_start` 同时写 `s.tools[id].args`，后续只读 `s.tools[id]`） |

### 1.3 事件处理

- **onServer**（11 case）：`dirs` / `session_opened` / `session_closed` / `agent_event` / `file_content` / `dir_content` / `commands` / `models` / `sessions_list` / `entries_tree` / `error`
- **onAgentEvent**（8 case）：`agent_start` / `agent_settled` / `message_start` / `message_update` / `message_end` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
- **handler**（14 个）：见 App.tsx

### 1.4 现状逻辑要点（重构必须保留的行为）

以下行为散落在 App.tsx，重构时**每一处都要有明确归属**，不能丢：

1. **`send()` 乐观追加用户消息**：发 WS 前，本地 `messages.push({role:"user",content:text})`。→ 需 `append_user_message` action。
2. **`session_opened` 后补发两条 WS**：`list_dir` + `list_commands`（拉取该会话的目录/命令）。→ reducer 只改状态，这两条 send 放 `useWebSocket.onmessage`（dispatch 之后）。
3. **`tool_execution_end` 延迟 1500ms 删卡片**：现状 `setTimeout(updateSession 删 tool, 1500)`。reducer 不能内嵌定时器 → 在 hook 层 dispatch `end` 后 `setTimeout` 再 dispatch `drop_tool`，reducer 仍纯。
4. **`entries_tree` 守卫**：`setTreePicker(prev => prev ? {...} : prev)`——picker 关闭时丢弃消息。→ reducer case 内 `if (state.ui.treePicker === null) return state;`。
5. **`session_closed` 清空 active**：`if (active === sessionId) setActive(null)`。→ reducer case 内判断，不另发 `set_active`。
6. **重连后连续 session_opened 焦点跳转**（现状 bug，见 §9）。
7. **用户驱动的 UI 开关**（修评审 N1）：5 个 picker 开关、fileViewer 关闭、目录树 toggle——现状是 `setXxxPicker`/`setFileViewer`/改 `expandedDirs`。进 reducer 后需对应 action：`ui_picker_open/close`、`ui_tree_open`、`ui_file_viewer_close`、`toggle_dir`。

## 2. 目标

单一职责 · 状态可预测（reducer）· 类型贯穿（SDK 的 `AgentEvent`/`AgentMessage`）。

## 3. 目标目录结构

```
src/
├── main.tsx
├── App.tsx                  ← useReducer + useWebSocket + 组合布局（目标 ~60 行）
├── types.ts                 ← 前端类型
├── state/
│   └── sessionReducer.ts    ← 纯函数 reducer + action creators
├── hooks/
│   └── useWebSocket.ts      ← WS 连接 + 自动重连 + 消息 → dispatch + 副作用 send
├── lib/
│   └── wsClient.ts          ← WS 封装：send / onMessage / 状态
└── components/
    ├── Sidebar.tsx
    ├── ChatPanel.tsx         ← 含 input/cmdIndex/filteredCmds + CommandPalette 渲染
    ├── CommandPalette.tsx    ← 纯受控（props: cmds/cmdIndex/onSelect），不管焦点
    ├── FileViewer.tsx
    ├── Markdown.tsx          ← react-markdown + remark-gfm + rehype-highlight（ADR-013/014），被 LazyMarkdown 懒加载
    ├── LazyMarkdown.tsx      ← React.lazy 包装 Markdown，拆独立 chunk 首屏不加载（ADR-015）
    ├── pickers/{Modal,ModelPicker,ThinkingPicker,SessionPicker,TreePicker}.tsx
    ├── MessageView.tsx / FileTree.tsx / EntryTree.tsx   ← 已有
```

## 4. 状态模型（reducer）

> **两套状态源**（[ADR-017](../adr/017-stream-data-external-store.md)）：低频状态（会话/消息/工具开关/UI 等）在本节 reducer 的 `AppState`；
> 高频流式数据（`streamText` + 工具流式 `output`）在独立的 `useSyncExternalStore` 外部 store（`src/state/streamStore.ts`），
> 按 sessionId 细粒度订阅——避免 token 级更新（每秒数十次）触发整树重渲染。`SessionState.streamText` 与 `ToolInfo.output` 字段已移除。

```ts
interface AppState {
  sessions: Record<string, SessionState>;
  sessionOrder: string[];
  activeSessionId: string | null;
  dirs: string[];
  models: ModelInfo[];
  historySessions: SessionInfo[];
  ui: {
    fileViewer: { path: string; content: string } | null;
    modelPicker: boolean;
    thinkingPicker: boolean;
    sessionPicker: boolean;
    treePicker: { mode: "navigate" | "fork"; tree: EntryTreeNode[]; leafId: string | null } | null;
  };
  globalError: string | null;
}

type Action =
  // —— onServer 11 case ——
  | { type: "dirs"; dirs: string[] }
  | { type: "session_opened"; sessionId: string; cwd: string; messages: AgentMessage[] }
  | { type: "session_closed"; sessionId: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "dir_content"; sessionId: string; path: string; entries: DirEntry[] }
  | { type: "commands"; sessionId: string; commands: CommandInfo[] }
  | { type: "models"; models: ModelInfo[] }
  | { type: "sessions_list"; sessions: SessionInfo[] }
  | { type: "entries_tree"; tree: EntryTreeNode[]; leafId: string | null }
  | { type: "error"; message: string; sessionId?: string }
  // —— onAgentEvent（合并为单一 action，reducer 内 switch event.type）——
  | { type: "agent_event"; sessionId: string; event: AgentEvent }
  // —— 用户操作：会话/消息 ——
  | { type: "set_active"; sessionId: string }
  | { type: "append_user_message"; sessionId: string; text: string }   // ★ send() 乐观追加（修评审 P1）
  | { type: "drop_tool"; sessionId: string; toolCallId: string }       // ★ 延迟删工具卡片（修评审 P2）
  // —— 用户操作：UI 开关（picker / fileViewer / 目录展开）★ 修评审第二轮 N1 ——
  | { type: "ui_file_viewer_close" }
  | { type: "ui_picker_open"; which: "model" | "thinking" | "session" }
  | { type: "ui_picker_close"; which: "model" | "thinking" | "session" | "tree" }
  | { type: "ui_tree_open"; mode: "navigate" | "fork" }   // 带 mode 开，tree 初始空（数据由 entries_tree 填）
  | { type: "toggle_dir"; sessionId: string; dir: string };
```

**reducer 内的关键逻辑**（非纯逻辑不进 reducer）：
- `session_opened`：更新 sessions/order；**重连复用时不抢焦点**——仅当该 sessionId 之前不在 sessions 里才 setActive（修现状 bug）。
- `session_closed`：删 sessions/order；`activeSessionId = active===sessionId ? null : active`（修 P5）。
- `entries_tree`：`if (state.ui.treePicker === null) return state;` 保留守卫（修 P4）。
- `agent_event` → tool_execution_end：标记完成，**不在 reducer 内 setTimeout**；删卡片由 hook 层 dispatch `drop_tool`（修 P2）。

### 4.1 删除镜像 ref，保留 1 个 stateRef（见 ADR-008）

```ts
const [state, dispatch] = useReducer(sessionReducer, initial);
const stateRef = useRef(state);
useEffect(() => { stateRef.current = state; }, [state]);  // 仅供重连读快照

// useWebSocket.onopen（重连）：
// 1) 清旧错误横幅（现状 setGlobalError(null)）
dispatch({ type: "error", message: "", sessionId: undefined });  // 或单独 clear_global_error
// 2) 重订阅所有活跃会话
for (const sid of stateRef.current.sessionOrder) {
  wsClient.send({ type: "open_session", cwd: stateRef.current.sessions[sid]?.cwd, sessionId: sid });
}
```

> 用 `useEffect` 同步有理论时序窗口（连续 dispatch 同 tick 内 stateRef 滞后），但重连不在高频 dispatch 中，实际无影响。若严格，可用 `useLayoutEffect` 或 dispatch 包装层同步赋值——边界细节，非阻塞。

## 5. 事件流 + 副作用归属

```
WS onmessage ──► useWebSocket:
                   ├─ dispatch(action)          // 状态变更（纯）
                   └─ 副作用 send（按消息类型）   // 如 session_opened 后补发 list_dir/list_commands
                                                    tool_end 后 setTimeout → dispatch(drop_tool)
用户操作 ──► 组件:
            ├─ dispatch(action)   // 本地状态（如 append_user_message、ui_picker_open、toggle_dir）
            └─ 调 App 传入的回调   // 回调内部 wsClient.send（回调派发式，见上）
```

**agent_event 分流**（[ADR-017](../adr/017-stream-data-external-store.md)）：`message_start` / `message_update`(text_delta) / `tool_execution_update` 三个高频事件直接写 `streamStore`（外部 store），**不 dispatch**——避免 token 级更新触发整树重渲染；`message_end` 先清 `streamStore` 再 dispatch（落定消息）。低频事件正常 dispatch。

**关键**：所有 WS 主动 send（补发 list_dir/list_commands、重连重订阅）集中在 `useWebSocket` hook 层；reducer 纯函数只管状态。**用户驱动的 send**（prompt/abort/命令/picker 选择）由组件调 **App 传入的回调**（回调内部 `wsClient.send`）——即回调派发式，组件不直接持有 wsClient，更纯、可测（与 §6「组件不管 WS」一致）。

## 6. 组件职责边界

| 组件 | props | 职责 | 不做什么 |
|------|-------|------|---------|
| `App` | — | useReducer + useWebSocket + 组合布局 | 不含业务逻辑 |
| `Sidebar` | sessions/order/active + 回调 | 目录、会话列表、文件树 | 不管 WS |
| `ChatPanel` | `{ sessionId, session }` + send/abort 回调 | **虚拟列表消息流**（ADR-018，react-virtuoso）+ 输入（含 input/cmdIndex/filteredCmds 局部态）+ textarea onKeyDown 分流 | 不管 picker |
| `CommandPalette` | `cmds`/`cmdIndex`/`onSelect` | **纯受控**渲染高亮，不管焦点/不持状态 | 不发 WS、不管 onKeyDown |
| `pickers/Modal` | open/onClose/children | 通用模态骨架 | 不管业务内容 |
| 各 Picker | 数据 + onSelect | 渲染选项 + 回调 | 不含模态骨架 |

> 命令补全：`input`/`cmdIndex`/`filteredCmds` 是 **ChatPanel** 的局部态（textarea 在它里面）；`CommandPalette` 纯受控渲染。onKeyDown 留在 ChatPanel 的 textarea，按 `filteredCmds.length` 分流（补全 vs 发送）。

## 7. 类型贯穿

`types.ts` 复用 pi 的类型，不再 any。**注意 import 来源**（评审第四轮核实）：

```ts
// server/types.ts 顶部（需先加依赖，见下）
import type { AgentMessage } from "@earendil-works/pi-agent-core";       // messages 的元素类型
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"; // agent_event 的 event 类型（= session.subscribe 回调参数）
```

- `session_opened.messages`: `unknown[]` → **`AgentMessage[]`**
- `agent_event.event`: `unknown` → **`AgentSessionEvent`**（server 转发的是 AgentSession 的事件流，即 `AgentEvent` 的超集，故用 `AgentSessionEvent`）
- `onMessage(msg: ServerMessage)` switch 有穷尽检查。

> **前提**：`AgentMessage` 来自 `@earendil-works/pi-agent-core`，而该包不是 web-console 的直接依赖（只嵌套在 pi-coding-agent 下）。需先 `npm install @earendil-works/pi-agent-core@^0.84.1`，否则 import 解析不到。`AgentSessionEvent` 无需新增依赖。

> **`model_changed` / `thinking_changed`**：server/types.ts 里有这两个 ServerMessage，但现状前端**未消费**（onServer 不处理）。重构后 onMessage 内对它们**显式 no-op**（`case "model_changed": break;`），保留忽略行为，满足穷尽检查；reducer 不加对应 case。

## 8. 重构路线（6 步，每步独立 typecheck + 验收）

> 低风险先行；Step 2（状态迁移，核心）拆成 2a/2b。

### Step 1：抽类型（`types.ts`）— 低风险
- 提取 `SessionState`/`DirEntry`/`CommandInfo`/`ModelInfo`/`SessionInfo`；`messages: any[]` → `AgentMessage[]`
- 验收：typecheck + 界面无变化

### Step 2a：reducer 接管 state，逻辑等价（镜像 ref 暂留）— 中风险
- 建 `sessionReducer.ts`，14 useState → `AppState`；onServer/onAgentEvent 的 setState 逻辑搬进 reducer case（含 §1.4 全部行为：append_user_message、session_opened 不抢焦点、session_closed 清 active、entries_tree 守卫、drop_tool）
- **用户驱动的 UI 动作也转 dispatch**（修评审 N1）：picker 开关→`ui_picker_open/close`、`ui_tree_open`；fileViewer 关闭→`ui_file_viewer_close`；目录展开→`toggle_dir`。即原 `setModelPicker(true)` 等改成 `dispatch({type:"ui_picker_open",which:"model"})`
- App.tsx 改 `useReducer`；`active = state.sessions[state.activeSessionId]`
- **镜像 ref 暂留**（activeSessionIdRef/sessionOrderRef/sessionsRef 仍用，保证重连路径不变）
- **副作用落点（2a 期间）**：onServer/onAgentEvent 仍在 App.tsx，副作用（session_opened 后补发 list_dir/list_commands、tool_end 后 setTimeout 删卡片）**暂留在 onServer/onAgentEvent 函数内**，只把 setState 换成 dispatch。Step 3 抽 hook 时再搬进 useWebSocket。
- 验收：typecheck + **全功能回归**（发消息能看到自己消息、切会话、/命令、各 picker 开关、工具卡片延迟消失、断线重连）

### Step 2b：删镜像 ref + 引入 stateRef + 改造重连 — 中风险
- 删 3 个镜像 ref；引入 1 个 `stateRef`（useEffect 同步）；useWebSocket.onopen 改用 stateRef 读快照重订阅
- 验收：typecheck + **断线重连专项**（停后端→重启→所有会话自动恢复 + 焦点不乱跳）

### Step 3：抽 hooks（`useWebSocket` + `wsClient`）— 中风险
- `wsClient.ts` 封装 WebSocket；`useWebSocket.ts` 连接+重连+onmessage→dispatch+副作用 send（session_opened 补发、tool_end 延迟 drop）
- App.tsx 的 WS useEffect 删除
- 验收：typecheck + 重连 + 发消息

### Step 4：抽 `Modal` + 各 Picker + FileViewer — 低风险
- 消除 5 处重复模态 JSX
- 验收：typecheck + 逐个 picker 开关

### Step 5：抽 `Sidebar` / `ChatPanel` / `CommandPalette` — 低风险
- ChatPanel 含 input/cmdIndex 局部态 + CommandPalette 纯受控
- 验收：typecheck + 完整功能回归

### 每步通用验收
`npm run typecheck` + 手动关键路径。重构期间**不动后端**（server/）。

## 9. 已知缺陷（重构时记录，是否本次修复待定）

- ~~**scroll 强制拉底**~~：✅ 已由虚拟列表的 `followOutput` 解决（ADR-018）——用户不在底部时不自动滚动，在底部时跟随新消息/流式输出。
- **重连焦点跳转**：onopen 重订阅每个会话，每个 session_opened 都 setActive，最后一个覆盖用户当前查看的会话。**Step 2a 修复**（session_opened 仅在「新会话」时 setActive）。

## 10. 已记 ADR

- [ADR-007](../adr/007-statemanager-usereducer.md)：状态管理选 useReducer（零依赖）而非 zustand；迁移触发条件。
- [ADR-008](../adr/008-stateref-for-reconnect.md)：保留单一 stateRef 供重连读快照（纯 dispatch 理论 vs 实用 ref 的取舍）。
- [ADR-017](../adr/017-stream-data-external-store.md)：流式数据（streamText + 工具 output）移出 reducer 到 useSyncExternalStore 外部 store，根治流式输出时的全局重渲染卡顿。
- [ADR-018](../adr/018-message-list-virtualization.md)：消息列表虚拟化（react-virtuoso），只渲染可见的 ~10 条消息，根治大量消息（470+）首次/重新渲染的手机卡顿。
