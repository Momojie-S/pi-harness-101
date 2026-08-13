# ADR-007: 手动 compact 期间的竞态与循环恢复

## 状态

Accepted

## 背景

goal 循环由 `agent_settled` 事件驱动：agent 干完活 → settled → 裁判判 done/continue/wait → 续行或停。当用户手动输入 `/compact` 打断正在工作的 agent turn 时，循环会静默卡死。

### 根因调查（pi 源码分析）

追踪 pi `agent-session.js` 的 `compact()` 方法，手动压缩的完整时序：

```
1. compact() → await abort()
2.   abort() → this.agent.abort() + await waitForIdle()
3.     agent loop 因 abort 信号退出 → finally → _emitAgentSettled()
4.       _isAgentRunActive = false
5.       await emit("agent_settled")  ← goal handler 在这里跑
6.         goal handler: 裁判跑完 → sendContinuation → setTimeout(0) 排入 macrotask 队列
7.       emit 完成 → _resolveIdleWaitIfIdle() → resolve idle promise
8.     waitForIdle() 返回 → abort() 返回
9.   _compactionAbortController = new AbortController()  ← 🔒 同步加锁（microtask 链内）
10.  压缩开始（调 LLM 做摘要，耗时数秒）
11.  [event loop 清空 microtask] → setTimeout(0) macrotask 触发
12.    pi.sendUserMessage(prompt) → prompt() → 检查 _compactionAbortController !== undefined
13.    💥 抛异常："Cannot submit a prompt while compaction is in progress"
14.  压缩完成 → _compactionAbortController = undefined ← 🔓 解锁
15.  session_compact 事件触发 → agent idle → 循环卡死 💀
```

**竞态的结构性根因**：`setTimeout(0)` 是 **macrotask**，排在所有 microtask 之后。而 `_compactionAbortController` 赋值在 `compact()` 的 microtask 链内（step 9），**必然**在 setTimeout（step 11）之前执行。这不是偶发时序问题，是确定性的。

**两层问题**：
1. **续行丢失**：裁判的续行 `sendUserMessage` 被锁拒绝 → 循环永久卡死。
2. **未捕获异常**：`sendUserMessage` 的异常在 `setTimeout` 回调里无人捕获 → Node.js `uncaughtException`，可能崩溃进程。

### 为什么自动压缩（overflow/threshold）没有这个问题

自动压缩发生在 agent loop **内部**（`_handlePostAgentRun()` → `_checkCompaction()`），此时 `_isAgentRunActive` 仍为 true，`agent_settled` 还没触发。压缩 + 重试完成后，`agent_settled` 才触发——此时 `_compactionAbortController` 锁早已释放。裁判的续行正常成功。

| 压缩类型 | 触发时机 | `_isAgentRunActive` | `agent_settled` 触发时锁状态 | 续行结果 |
|---------|---------|---------------------|---------------------------|---------|
| 手动 `/compact` | `compact()` → `abort()` | false（abort 设的） | 🔒 锁还在 | 💥 失败 |
| overflow | `_handlePostAgentRun()` | true | 🔓 已释放 | ✅ 成功 |
| threshold | `prompt()` 入口 | true | 🔓 已释放 | ✅ 成功 |

## 决策

两层防护，分别覆盖两个问题：

### 防护 1：`sendContinuation` 的 setTimeout 回调加 try/catch

```typescript
setTimeout(() => {
    const g = getGoal();
    if (!g || g.status !== "active") return;
    if (!opts?.force && typeof ctx.isIdle === "function" && !ctx.isIdle()) return;
    try {
        pi.sendUserMessage(prompt);
    } catch {
        // sendUserMessage 在 compaction 进行中会抛异常（_compactionAbortController 锁）。
        // 静默吞掉——session_compact handler 会负责恢复循环。
    }
}, 0);
```

防 `uncaughtException`。异常被吞掉后续行确实丢了，但防护 2 会补。

### 防护 2：`session_compact` 事件 handler 补发续行

```typescript
pi.on("session_compact", async (_event, ctx) => {
    const goal = getGoal();
    if (!goal || goal.status !== "active") return;
    sendContinuation(ctx, "continueSoloOrAttended", {
        judgeGaps: `上下文已压缩，继续推进（已用 ${goal.turnsUsed} 轮，上次裁决：${goal.lastVerdict ?? "-"}）`,
    });
});
```

`session_compact` 在压缩**完成后**触发（step 14-15），此时锁已释放，`sendUserMessage` 必然成功。

**为什么 session_compact 对自动压缩无害**：自动压缩时 `session_compact` 也会触发，但此时 `_isAgentRunActive` 为 true（agent 正在重试），`sendContinuation` 内部的 `isIdle()` 检查返回 false → 自动跳过，不重复注入。

## 备选方案

| 方案 | 优点 | 缺点 | 选不选 |
|------|------|------|--------|
| **两层防护（采纳）** | 精准解决两个问题，改动最小 | session_compact handler 多了一个事件监听 | ✅ |
| 检查 `ctx.isCompacting` 防止竞态 | 根因级修复 | pi 扩展 API 不暴露 compaction 状态 | ❌ 不可行 |
| 用更长 delay（如 setTimeout(500)）绕开锁 | 简单 | 脆弱（delay 值靠猜），治标不治本 | ❌ |
| 不处理（接受手动 compact 会断循环） | 零改动 | 用户体验差，循环静默死亡 | ❌ |
| session_before_compact 全量自定义摘要 | 完全控制压缩内容 | 太重（自己调 LLM 做摘要），且 `SessionBeforeCompactResult` 不支持改 `customInstructions` | ❌ |

## 后果

### 正面

- 手动 `/compact` 打断 goal turn 后循环自动恢复，用户无感。
- `uncaughtException` 被捕获，不会污染日志或崩溃进程。
- 自动压缩（overflow/threshold）不受影响。

### 负面

- 多一个 `session_compact` 事件监听，增加一点复杂度。
- 双 setTimeout 续行的极低概率竞态：裁判的 `setTimeout(0)` 若碰巧在锁释放后才 fire（理论上不会，但若 pi 未来改实现），同时 session_compact handler 的 `setTimeout(0)` 也 fire，两个 `sendUserMessage` 可能同时进入 pi 的 `prompt()`。`sendContinuation` 的 `isIdle()` 检查能挡住第二个，但 `isIdle()` 和 `_isAgentRunActive` 设置之间有 async gap。概率极低，pi 自身的并发控制应能兜住，不额外加锁。

## 参考

- pi 源码：`agent-session.js` `compact()` (line 1367)、`abort()` (line 1168)、`_emitAgentSettled()` (line 327)、`_runAgentPrompt()` (line 744)、`prompt()` compaction 检查 (line 807)
- Node.js 事件循环：microtask（Promise 链）先于 macrotask（setTimeout）执行
- 设计文档：`design.md` §8 "跨 compaction 恢复"
