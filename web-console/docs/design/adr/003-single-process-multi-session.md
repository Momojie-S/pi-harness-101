# ADR-003: 单进程管理多工作目录 / 多会话

## 状态

Accepted

## 背景

Web Console 要支持同时操作多个工作目录、每个目录可能有多个会话。

pi 的核心约束：**单个 `AgentSession` 绑定一个工作目录（cwd）**——内置工具（read/bash/edit/write）按 cwd 构建，`SessionManager` 按 cwd 分目录存储会话。因此"一个 pi 实例管多个目录"不可行（除非用 bash `cd` 硬切，会污染工具路径与 session 归属）。

需要决定如何在 Web Console 中组织多目录 / 多会话。

## 决策

**单 Web 服务进程 + Map 管理，按需为每个「目录 + 会话」创建 pi 实例**：

```
sessions: Map<string, AgentSession>   // key = `${cwd}::${sessionId}`
```

- 前端选择「工作目录 + 会话」时，Web 服务查 Map：命中则复用，未命中则 `createAgentSession({ cwd, sessionManager })` 创建
- `SessionManager` 按 cwd 自动分目录存储，不同目录的会话天然隔离，互不串扰
- 同一目录可开多个并发会话（不同 sessionId）
- 空闲过久的实例可 `dispose()` 释放内存（会话已落盘，下次按 sessionId 恢复即可）

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **单进程 + Map 多实例（本决策）** | 资源省、并发好、同目录多会话天然支持、SessionManager 自动隔离存储 | 所有实例共享一个进程（与 ADR-002 同一权衡） |
| 每工作目录长期持有单实例 | 实现最简单 | 同目录无法并发多会话 |
| 每会话独立子进程（RPC） | 隔离最强 | 资源开销大、管理复杂（与 ADR-002 备选一致） |

## 后果

### 正面

- 一个常驻 Web 服务即可覆盖所有目录与会话，无需为每个目录单独启动服务
- SessionManager 按 cwd 分目录，存储隔离天然可靠
- 支持同目录多个并行会话（如一边跑实现、一边跑 review）

### 负面

- 进程内存随活跃会话数增长；需配合空闲回收（`dispose()`）控制
- 单进程崩溃影响所有会话；缓解见 ADR-002（进程守护 + 崩溃重启）

## 参考

- [pi SDK - Session Management](../../../../node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)
- [design.md - 核心机制](../design.md#核心机制)
