# 状态栏（模型 + Context 占用）

> 角色：**功能设计文档**。记录"显示当前模型 + context 占用"这个功能的数据流、状态归属、UI 决策。
> 关联：整体架构见 [../design.md](../design.md)；WS 消息契约见 `server/types.ts`；前端状态见 [frontend-architecture.md](frontend-architecture.md)。

## 1. 背景与目标

用户在使用 web-console 时，需要随时知道两件事：

1. **当前会话用的是哪个模型**（尤其多会话场景下不同会话可能切过模型）。
2. **上下文还剩多少**（何时该 `/compact`，避免溢出）。

pi 的 TUI 有状态栏展示这些信息，web-console 作为远程界面同样需要。

## 2. 数据来源（SDK 直接提供，无需自行估算）

| 信息 | SDK API | 返回 |
|------|---------|------|
| 当前模型 | `AgentSession.model` getter | `Model<any>`（含 `provider` / `id` / `name`） |
| Context 占用 | `AgentSession.getContextUsage()` | `{ tokens: number\|null, contextWindow: number, percent: number\|null }` |
| 累计 token/cost | `AgentSession.getSessionStats()` | `SessionStats`（本次未使用，预留） |

### `getContextUsage()` 的关键特性

该方法是**实时计算**的——读取当前会话分支上最后一条 assistant message 的 `usage.inputTokens` 来推算当前 context 大小。含义：

- **不需要轮询**。在 agent 运行期间值不变（读的是已有的 usage），轮询无意义。
- **`tokens` 可能为 `null`**：刚 compact 完、或尚无 assistant 响应时，token 数未知。此时 `percent` 也为 `null`。
- **可靠刷新时机 = `agent_settled`**（每轮结束）：此时最后一条 assistant 的 usage 刚好可用。

## 3. WS 协议扩展

### 3.1 新增/修改的 ServerMessage

```ts
// session_opened 新增 model 字段（前端一进来就知道当前模型）
| { type: "session_opened"; ...; model: ModelIdentity }

// model_changed 改用 ModelIdentity（原先扁平的 provider/modelId/name 三字段收敛为一个对象）
| { type: "model_changed"; sessionId: string; model: ModelIdentity }

// 新增：context 占用推送
| { type: "context_usage"; sessionId: string; usage: ContextUsagePayload }
```

`ModelIdentity` / `ContextUsagePayload` 定义在 `server/types.ts`，前端 `src/types.ts` re-export 复用（单一 import 来源）。

### 3.2 推送时机

| 时机 | 推送内容 | 触发位置 |
|------|---------|---------|
| `open_session` / `open_history` / `navigate` / `fork` | `session_opened`（带 model） | `server/ws.ts` 各 case |
| `set_model` | `model_changed` | `server/ws.ts` set_model case |
| `agent_settled`（每轮结束） | `context_usage` | `server/session-store.ts` 事件订阅回调 |

后两者（model_changed / context_usage）**只推给该会话的订阅者**，不广播。

> **为什么 agent_settled 而非 message_end？**
> `agent_settled` 表示一整轮（含所有工具调用 + 追问）彻底结束，语义最干净。message_end 每条消息触发一次，过于频繁且部分中间状态 context 未刷新。

## 4. 前端状态归属

`SessionState` 新增两字段：

```ts
export interface SessionState {
  // ... 现有字段
  model: ModelIdentity | null;         // session_opened 填充、model_changed 更新
  contextUsage: ContextUsagePayload | null;  // context_usage 更新
}
```

reducer 新增两个 case（`model_changed` / `context_usage`），`session_opened` case 填充 `model`。均为纯状态更新，无副作用。

> **历史背景**：`model_changed` 这个 ServerMessage 早就在协议里了（set_model 触发），但前端 `onServer` 一直 no-op（见 frontend-architecture.md §7）。本次让它正式被消费。

## 5. UI 设计

### 5.1 位置

输入框**上方**一条状态栏（不在消息流顶部——会被滚走）：

```
┌─────────────────────────────────────┐
│  消息流（滚动区）                     │
├─────────────────────────────────────┤
│ claude-sonnet-4 ▾  ▓▓▓░░░ 45% 12k/200k │  ← StatusBar
├─────────────────────────────────────┤
│ [输入框]                      [发送]   │
└─────────────────────────────────────┘
```

### 5.2 PC 端 vs 移动端（响应式折叠）

| 元素 | PC（`sm:` 及以上） | 移动端（默认） |
|------|-------------------|---------------|
| 模型名 | 完整显示 | 完整显示 |
| 进度条 | 宽 `w-24` | 窄 `w-12` |
| 百分比 | 显示 | 显示 |
| used/window token 数 | 显示（`sm:inline`） | 隐藏 |

移动端只保留"模型名 + 进度条 + 百分比"三个最关键信息，节省横向空间。

### 5.3 进度条颜色阈值

| 占用 | 颜色 | 语义 |
|------|------|------|
| < 70% | 绿（`bg-emerald-500`） | 充裕 |
| 70-90% | 黄（`bg-amber-500`） | 注意 |
| > 90% | 红（`bg-red-500`） | 危险（该 compact 了） |

### 5.4 特殊状态

- **`tokens === null`（compact 后未知）**：进度条空、显示「上下文就绪」或 streaming 时「计算中…」，不显示 0% 以免误导。
- **无模型**：显示「未选择模型」。

## 6. 交互

点击模型名 → 触发 `ModelPicker`（复用现有 `/model` 命令的打开逻辑：dispatch `ui_picker_open` + ws send `list_models`）。

## 7. 涉及文件

| 层 | 文件 | 改动 |
|----|------|------|
| 后端类型 | `server/types.ts` | `session_opened` 加 model；新增 `model_changed`（改签名）、`context_usage`；`ModelIdentity` / `ContextUsagePayload` |
| 后端逻辑 | `server/session-store.ts` | `agent_settled` 推 context_usage；`getModelInfo()` / `getContextUsage()` helper |
| 后端 WS | `server/ws.ts` | 所有 session_opened 带 model；set_model 用 ModelIdentity |
| 前端类型 | `src/types.ts` | SessionState 加 model / contextUsage；re-export ModelIdentity / ContextUsagePayload |
| 前端状态 | `src/state/sessionReducer.ts` | session_opened 填 model；新增 model_changed / context_usage case |
| 前端通信 | `src/hooks/useWebSocket.ts` | model_changed 改 dispatch；session_opened 带 model；context_usage 新增 dispatch |
| 前端组件 | `src/components/StatusBar.tsx` | **新文件** |
| 前端组件 | `src/components/ChatPanel.tsx` | 集成 StatusBar |
| 前端组件 | `src/App.tsx` | 传 `onOpenModelPicker` 回调 |

## 8. 未使用 / 预留

- `getSessionStats()` 提供累计 token（输入/输出/cache 分项）和 cost，本次未展示（状态栏信息密度已够）。若后续要加「累计花费」面板，可直接复用现有 `ContextUsagePayload` 旁新增 stats 消息。
