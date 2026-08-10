# ADR-002: 用 SDK 同进程驱动 pi，而非 RPC 子进程

## 状态

Accepted

## 背景

Web Console 需要驱动 pi 来执行用户的编码任务。pi 提供两种集成方式：

1. **SDK**：`import { createAgentSession } from "@earendil-works/pi-coding-agent"`，在同一 Node 进程内创建 AgentSession
2. **RPC 模式**：`pi --mode rpc` 作为独立子进程，通过 stdin/stdout 的 JSONL 协议通信

需要决定 Web Console 用哪种方式驱动 pi。

## 决策

**用 SDK 同进程**：Web Console 的 Node 服务直接 `createAgentSession({ cwd, sessionManager })` 创建 pi 实例，通过 `session.subscribe()` 订阅事件、`session.prompt()` 驱动执行。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **SDK 同进程（本决策）** | 资源开销小（共享一个 Node 进程）；类型安全；直接函数调用 + 事件订阅，无需解析 JSONL；多实例管理简单（一个 Map） | 实例隔离是进程级而非 OS 级，一个实例的未捕获异常理论上影响整体 |
| 多个 `pi --mode rpc` 子进程 | 进程级隔离，一个崩溃不影响其他；语言无关（可从任意语言调用） | 每会话一个进程，内存开销大；需自己实现 JSONL 协议客户端；类型不安全；多进程管理更复杂 |

## 后果

### 正面

- 单进程承载所有会话，资源占用低，适合个人 / 内网场景（目录和并发会话数量有限）
- 直接享受 SDK 的类型与 API（`AgentSession`、`SessionManager`、`ModelRuntime` 等）
- 前后端在同一 Node 进程，WebSocket handler 直接调用 SDK，转发简单

### 负面

- 失去 OS 级隔离。若某次 pi 实例引发未捕获异常，理论上可能拖垮整个 Web 服务
- 缓解：SDK 的各 `AgentSession` 状态独立；Web 服务层做好异常捕获与进程守护（PM2 / nssm 崩溃重启）；若未来确需强隔离，可按此 ADR 的备选方案切换为 RPC 子进程（新建 ADR 标 Superseded）

## 参考

- [pi SDK 文档](../../../../node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)
- [pi RPC 文档](../../../../node_modules/@earendil-works/pi-coding-agent/docs/rpc.md)
