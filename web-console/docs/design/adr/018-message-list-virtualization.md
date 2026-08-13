# ADR-018：消息列表虚拟化（react-virtuoso）

| 项 | 值 |
|----|----|
| 状态 | Accepted |
| 日期 | 2026-08-12 |

## 背景

ADR-017（streamStore）+ `React.memo` 解决了"reducer 更新时旧消息重复渲染"的问题。但移动端仍有严重卡顿，根因是**大量消息的首次/重新渲染**：

实测（桌面 CPU）：加载 470 条 markdown 消息，12 个 long task 共 **928ms**。手机 CPU 弱 3-5 倍 → **2.8-4.6 秒**。

`memo` 对此无效——切换会话时 `message` 变了（不同会话的消息），必须重新渲染；首屏加载、向上翻历史同理。当前架构把**全部已加载消息**都挂载到 DOM（`session.messages.map(...)`），470 条 markdown 全量解析。

## 决策

引入 **react-virtuoso** 对消息列表做虚拟化：只渲染可视区域内的 ~10 条消息，滚动时动态替换。

### 为什么选 react-virtuoso

| 方案 | 优点 | 缺点 |
|------|------|------|
| **react-virtuoso**（选中） | 自动测量动态高度（markdown 消息高度各异）；`followOutput` 自动跟随新消息（聊天核心需求）；`startReached` 天然适配向上加载更多 | 新依赖（~15KB gzip） |
| react-window | 轻量（~6KB） | `VariableSizeList` 需手动提供 itemSize，动态高度场景笨重 |
| @tanstack/react-virtual | headless 灵活、最小（~4KB） | 需手动处理滚动容器、动态测量、跟随逻辑，代码量大 |
| 手动窗口化 | 零依赖 | 变高度 + 滚动位置保持 + 流式跟随全要自己写，易出 bug |

react-virtuoso 专为"动态高度聊天列表"设计，开箱覆盖本项目全部需求（动态高度 / followOutput / startReached / 前置插入保持位置）。

## 后果

### 正面

- **渲染量 O(N) → O(可见)**：470 条消息只渲染 ~10 条可见的，手机渲染从秒级降到 <100ms。
- 切换会话、首屏加载、向上翻历史全部受益。
- `followOutput` 替代手动的 scrollTop 强制拉底（ADR-017 前的已知缺陷 §9），更可靠。

### 负面

- 新依赖 react-virtuoso（~15KB gzip），需 `npm install`。
- ChatPanel 消息区从 `div + map` 改为 `<Virtuoso>`，滚动控制逻辑（followOutput / startReached / firstItemIndex）需重写，有一定回归风险。
- 非消息元素（compacting 提示 / 流式文本 / 工具卡片 / steer 队列）需移入 Virtuoso 的 Header/Footer，结构变化。

## 参考

- [ADR-007](007-statemanager-usereducer.md)：useReducer 选型（本 ADR 引入渲染层依赖，不冲突）
- [ADR-017](017-stream-data-external-store.md)：流式数据外部 store（与本 ADR 互补：017 解决重复渲染，018 解决首次渲染量）
