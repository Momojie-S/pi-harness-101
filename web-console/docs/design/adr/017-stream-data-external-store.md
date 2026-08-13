# ADR-017：流式数据外部 store（绕开 reducer 根治重渲染卡顿）

| 项 | 值 |
|----|----|
| 状态 | Accepted |
| 日期 | 2026-08-12 |

## 背景

web-console 前端用单一 `useReducer` 管理全部状态（[ADR-007](007-statemanager-usereducer.md)）。agent 流式输出时有两类**高频事件**进 reducer：

- `message_update`（`text_delta`）：LLM token 级，每秒数十次
- `tool_execution_update`：长输出工具（如 bash）的流式输出

reducer 每次都返回新的顶层 `AppState` → 整棵组件树重渲染。由于组件未做 `memo`（Sidebar / 目录树 / 其他会话面板都跟着重渲染），只要一个会话在对话，点击目录树、切换会话等操作就卡顿——JS 主线程被高频 reconcile 占满。

这正是 [ADR-007](007-statemanager-usereducer.md)「迁移触发条件」第二条所述：「多个不相关组件需高频读同一状态切片导致 selector 性能问题」。

## 决策

将两个高频更新源（`streamText` + 工具流式 `output`）移出 `useReducer`，放入独立的 `useSyncExternalStore` 外部 store（`src/state/streamStore.ts`），按 `sessionId` 细粒度读取。低频状态继续走 `useReducer` 不变。

**数据流变更**：

```
变更前：message_update → dispatch → reducer 返回新 AppState → 整树重渲染
变更后：message_update → streamStore.appendText → 仅读取该值的组件重渲染
```

`onServerMessage` 对 `agent_event` 分流：

- `message_start` / `message_update`（text_delta）/ `tool_execution_update` → 写 streamStore，**不 dispatch**
- `message_end` → 清 streamStore + dispatch（落定消息进 messages）
- 其余低频事件 → 正常 dispatch

读取侧：ChatPanel 用 `useStreamText(sessionId)` 取流式文本；每个工具卡片抽成 `ToolCard` 组件，用 `useToolOutput(sessionId, toolCallId)` 独立订阅自己的输出。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. useSyncExternalStore 外部化高频字段**（选中） | 精准命中根因；零新依赖（React 18 原生）；改动小；不破坏现有 reducer 架构 | streamText 不在单一 AppState 里，多一个 store；需自定义订阅 hook |
| B. 全量迁移 zustand | 天然 selector，彻底解决所有重渲染；ADR-007 预设的迁移路径 | 重写整个 state 层，改动大、风险高；引入依赖；本次只需隔离两个字段，杀鸡用牛刀 |
| C. 组件 memo + useCallback | 改动最小 | 治标不治本：token 仍进 reducer，每 token 仍触发 App 重渲染（子组件被 memo 挡住，但 reducer 计算 + diff 仍占 CPU）；且项目当前零 memo，全量加 memo 本身也是不小改动 |

选 A：精准解决「高频更新触发全局重渲染」，不改变整体架构、不引入依赖。zustand 迁移（方案 B）留待 action 真正膨胀或需要组件外全量访问 state 时再启动。

## 后果

### 正面

- **根治流式卡顿**：对话期间 reducer 不再高频更新，Sidebar / 目录树 / 其他会话面板完全不重渲染。
- **细粒度订阅**：每个 `ToolCard` 独立订阅自己的 output，单工具更新只重渲染该卡片。
- **零新依赖**：`useSyncExternalStore` 是 React 18 原生 API。
- **不破坏 ADR-007/008**：useReducer 仍是低频状态的唯一出口，stateRef 重连逻辑不变。

### 负面

- 流式数据不在单一 `AppState` 里，状态分散在两处（reducer + streamStore）。缓解：streamStore 职责单一（仅高频流式缓冲），注释明确边界。
- `SessionState.streamText` / `ToolInfo.output` 字段移除，需同步改 ChatPanel 读取方式。
- 高频事件的分流逻辑在 `onServerMessage`（非 reducer），需注释说明数据归属。

## 参考

- [ADR-007](007-statemanager-usereducer.md)：useReducer 选型 + 迁移触发条件
- [ADR-008](008-stateref-for-reconnect.md)：stateRef 重连读快照
- [frontend-architecture.md](../modules/frontend-architecture.md) §4：状态模型
