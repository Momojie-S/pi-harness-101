# 服务自重启（agent 触发）

> 角色：**功能设计文档**。记录"agent 触发 web-console 重启"的数据流、时序、关键决策。
> 关联：整体架构见 [../design.md](../design.md)；WS 消息契约见 `server/types.ts`；前端状态见 [frontend-architecture.md](frontend-architecture.md)。

## 1. 背景与目标

部署/更新 web-console 后需要重启服务。传统方式（杀进程 + 计划任务拉起）有两个问题：

1. **Windows 计划任务的 RestartOnFailure 不可靠**：即使 `RestartCount 999 / 间隔 1 分钟` 配置正确、ps1 也以非零码退出，任务调度器对"脚本类 action 的非零退出"基本不响应（详见 ops `pi-web-console.md` 变更记录）。
2. **用户体验差**：重启期间页面突然断开，用户不知道发生了什么。

本功能改为**应用层自管理重启**：agent（pi）通过 `restart_server` 工具触发，后端 spawn 接班进程 + 强制退出自己，接班进程恢复 session 后让 agent 自然继续。

## 2. 触发者与记录

- **触发者是 agent**（不是用户点按钮）：用户在对话里说"重启服务"，agent 调用 `restart_server` 工具。
- **记录哪个 session 触发的**：`restart_server` 是 web-console 给每个 session 注册的 custom tool（闭包捕获 sessionId/toolCallId），agent 调用时天然知道当前 session。
- **重启后通知该 session**：接班进程给悬空的 toolCallId 补一个 toolResult（"web 服务已重启完成"），agent 的 `continue()` 看到后自然回复用户——形成"触发重启 → 重启完成 → 继续工作"的闭环。

## 3. 完整流程

### ① 老进程（agent 调用 restart_server 工具）

```
execute(toolCallId):
  ├─ 落盘 pending：{ sessionId, sessionFile, toolCallId, cwd } → TEMP_DIR/restart-pending.json
  ├─ 广播 { type: "restarting", sessionId } 给所有 WS 客户端
  ├─ spawnReplacement()：spawn detached 接班进程（继承 Session + env）
  ├─ setTimeout(200ms) → process.kill(pid, SIGKILL)  ← 强制退出自己
  └─ return new Promise<never>(() => {})  ← execute 永不 resolve（进程会被 SIGKILL 终止）
```

此时 session 文件最后一条是 `assistant(toolCall)`，**无 toolResult**。

### ② 接班进程启动

```
main():
  ├─ 初始化 ModelRuntime + SessionStore + 监听端口（带 EADDRINUSE 重试）
  ├─ await recoverPendingSession(store):
  │   ├─ 读 pending（没有 = 正常启动，跳过）
  │   ├─ SessionManager.open(sessionFile)
  │   ├─ appendMessage(toolResult{ toolCallId, "web 服务已重启完成" })  ← 补 result
  │   ├─ store.restoreFromSessionManager(cwd, sm)  ← createAgentSession 恢复
  │   │   └─ buildSessionContext 读到 assistant(toolCall)→toolResult ✓
  │   ├─ session.agent.continue()  ← agent 看到 toolResult 后回复用户
  │   └─ clearPending()
  └─ 正常服务，等待前端重连
```

### ③ 前端重连

```
WS 断开（老进程退出）
  → useWebSocket 自动重连（已有能力）
  → onOpen: open_session(原 sessionId)
  → 后端 store.get(sessionId) 命中（② 已放进去）→ session_opened
  → 前端展示完整对话（含补的 toolResult + agent 的"重启完成"回复）
```

## 4. 关键技术决策

### 4.1 为什么用 SIGKILL 而非 process.exit(0)

`process.exit(0)` 在 tsx 环境下**会被 loader/preflight hook 拦截导致进程 hang**（实测：老进程不退出，占着端口，接班进程被 EADDRINUSE 挡住）。`process.kill(process.pid, "SIGKILL")` 是不可阻挡的强杀（Windows 上等价 `TerminateProcess`），可靠。

### 4.2 为什么 execute 返回永不 resolve 的 Promise

```ts
execute: async (toolCallId) => {
  // ... spawn + setTimeout(SIGKILL) ...
  return new Promise<never>(() => {});
}
```

如果不返回 pending Promise，pi 会认为工具执行完成（返回 undefined），在 SIGKILL 生效前进入下一轮 agent loop / 异常处理，干扰重启流程。返回永不 resolve 的 Promise 让 pi 一直等待，直到 SIGKILL 终止一切。

### 4.3 为什么补 toolResult 在 createAgentSession 之前

`Agent.continue()` 要求 `agent.state.messages` 最后一条是 user 或 toolResult。如果先 createAgentSession（读到 assistant(toolCall) 无 result）再补 toolResult，agent.state 已固定，continue 会报 "Cannot continue from message role: assistant"。所以接班进程**先** appendMessage 写文件，**再** createAgentSession 恢复（buildSessionContext 读到 toolResult），最后 continue 才合法。

### 4.4 为什么 spawn 后等 200ms 再退出

确保接班进程已 fork 出去（detached 子进程需要时间初始化）。如果不等，老进程 SIGKILL 时接班进程可能还没完全 detach。200ms 足够（实测稳定）。

### 4.5 端口释放时序

老进程 SIGKILL 后 3000 端口释放需要一瞬间。接班进程 `server.listen` 撞 EADDRINUSE 时自动 1 秒后重试（`server/index.ts` 的 error handler），端口释放后成功绑定。

## 5. 临时目录

所有运行时临时文件放 `os.tmpdir()/pi-web-console/`（系统临时目录下专属子目录）：

| 文件 | 用途 |
|------|------|
| `restart-pending.json` | 重启待恢复标记（接班进程处理完删除） |

定义在 `server/restart.ts` 的 `TEMP_DIR`，后续 web-console 的临时文件统一放这里。

## 6. WS 协议

新增一个 ServerMessage：

```ts
| { type: "restarting"; sessionId: string }
```

前端收到后置 `restarting: true`（reducer），显示"服务正在重启，连接恢复后将自动继续…"。WS 重连成功（onOpen）后清零。

## 7. 涉及文件

| 文件 | 改动 |
|------|------|
| `server/restart.ts` | **新文件**：TEMP_DIR + pending 管理 + spawnReplacement + recoverPendingSession |
| `server/session-store.ts` | 注册 `restart_server` custom tool；加 `restoreFromSessionManager` |
| `server/types.ts` | 新增 `restarting` ServerMessage |
| `server/index.ts` | 启动时 `recoverPendingSession`；listen 加 EADDRINUSE 重试 |
| `src/state/sessionReducer.ts` | AppState 加 `restarting`；`set_restarting` action |
| `src/hooks/useWebSocket.ts` | 处理 `restarting` 消息；onOpen 清零 |
| `src/App.tsx` / `src/components/ChatPanel.tsx` | 传 `restarting` prop + 显示提示 |

## 8. 验证记录（2026-08-11）

测试环境（3001，Session 0）端到端验证通过：
- agent 调用 restart_server → 老进程 spawn 接班 + SIGKILL 退出
- 接班进程读 pending → 补 toolResult → 恢复 session → agent.continue() 完成
- 前端 WS 重连 → open_session 命中 store → 显示补的 toolResult + agent 回复

线上（Session 1）同样验证通过。

### 第二轮 review 修复（同日）

经两轮子 agent review，额外修复：
- **幂等恢复**：recoverPendingSession 先检查 toolCallId 是否已有 result，防止崩溃后重复追加（I5）。
- **多 toolCall 悬空**：同一 assistant 轮次的其他未完成 toolCall 也补 result（标 isError，文本「服务重启，此工具结果丢失」）（I4）。
- **restarting 全广播**：重启是全局的，restarting 消息广播给所有 session 的订阅者（原只发给触发 session）（I6）。

### 第三轮 review（同日）

第三轮深度审查核实了四个核心机制**均无问题**（附 pi SDK 源码依据）：
- tryTriggerRestart 跨进程状态无污染（接班进程是新模块实例）。
- pending 生命周期无残留/过早清除。
- 前端 restarting 在 onOpen 清零语义正确（recover 在 listen 前 await 完成）。
- SIGKILL 时序安全：pi 在 message_end 同步持久化 assistant，execute 前必已落盘。

额外修复与已知限制：
- **P5 已修复**：前端 restarting 加 60s 超时兏底——接班进程起不来时提示「服务重启超时，请手动检查」。
- **P4 已修复**：recover 失败的日志补 sessionId/sessionFile，便于定位。
- **I7（已知限制）**：recover 失败立即 clearPending，瞬时失败会永久放弃自动 continue。当前取舍（避免重复尝试卡启动）。用户需手动再发消息触发 agent。
- **I8（降级场景，待办）**：recover 失败时 open_session 的 continueRecent fallback 可能打开错误的 session。正常路径不触发。
- **I9（待验证）**：createRestartTool 闭包捕获 sessionFile 快照，若 pi 内部换 sessionManager 可能陈旧。web-console 的 fork/navigate 走新建 ManagedSession，理论上不触发。

## 9. 与计划任务的关系

- **计划任务**：仍负责"开机/登录时启动"（AtLogOn 触发器可靠）——这是崩溃兜底（进程意外退出/重启机器后，登录时恢复）。
- **应用层自重启**（本功能）：负责"主动重启"——部署后 agent 触发，可靠且用户体验好。
- **不依赖 RestartOnFailure**：实测不可靠（见 §1），已放弃。

两者互补：计划任务管"冷启动"，自重启管"热重启"。
