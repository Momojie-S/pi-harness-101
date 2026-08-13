# ADR-016: /reload 命令——按会话重载扩展

## 标题

ADR-016: `/reload` 命令——不重建会话即可热重载扩展/skills/prompts

## 状态

Accepted

## 背景

web-console 开发扩展时，每次改扩展代码都要新建会话才能加载新版本（pi 在会话创建时绑定扩展）。

痛点：
1. **丢失对话上下文**：新建会话意味着之前的调试对话全丢，无法在同一上下文里迭代。
2. **测试断层**：开发中的扩展行为需要多轮对话验证，每次新建会话都要重新铺垫场景。
3. **pi 原生有 `AgentSession.reload()`**：重载扩展、skills、prompts，保留会话历史。但 web-console 没有暴露这个能力。

## 决策

在 web-console 加内置命令 `/reload`，调用 pi 原生的 `AgentSession.reload()`，重载后刷新命令列表（前端补全立即反映新扩展的命令）。

**实现层次**：方法 2（前端 + 后端原生实现），不走扩展机制——web-console 应该控制自身的会话生命周期。

具体实现：
- **后端** `session-store.ts`：`reloadSession(sessionId)` 调 `session.reload()`，返回刷新后的 `runtime.getCommands()`。
- **后端** `ws.ts`：`reload_session` 消息 → 调 reloadSession → 发 `reloaded` 消息（带刷新后的命令列表）。
- **前端** `ChatPanel.tsx`：`BUILTIN_COMMANDS` 加 `reload`（补全列表里显示）。
- **前端** `useWebSocket.ts`：`reloaded` 消息 → dispatch `commands`（刷新补全）+ `system_notice`（绿色反馈"已重载"）。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方法 1：扩展实现**（chrome-devtools 扩展注册 `/reload` 命令，handler 调 `ctx.session.reload()`） | 改动集中在一个扩展文件 | 命令是"管理 web-console 自身会话"的元操作，不该寄生在业务扩展里；且扩展 reload 自身时可能有时序问题（reload 自己的代码） |
| **方法 2：前端 + 后端原生**（web-console 自身实现命令）✅ 选中 | 职责清晰；reload 后能刷新前端命令列表（扩展机制做不到——扩展不控制前端补全）；reload 不涉及自身代码 | 需要前后端各改一点（4 个文件） |
| **方法 3：新建会话** | 实现最简单（已有） | 丢失上下文——开发体验差，不可接受 |

选中方法 2 的核心理由：**reload 是 web-console 管理自身会话生命周期的操作**，web-console 应该自己控制，不该委托给扩展。且只有 web-console 能在 reload 后刷新前端补全列表（扩展不知道前端状态）。

## 后果

### 正面

- 改扩展代码后 `/reload` 即生效，保留对话上下文——开发体验大幅改善。
- 命令列表自动刷新，新扩展的 `/cmd` 立即出现在补全里。
- 有绿色 system-notice 反馈，用户知道 reload 是否成功（遵守交互反馈纪律）。

### 负面

- reload 会重新执行所有扩展的 `session_start`（扩展需注意幂等性）。
- reload 不保留扩展的内存状态（如 goal 扩展的 `goalBySession` Map）——扩展需从 entries 恢复（goal 扩展已实现）。
- 增加了 web-console 的命令处理复杂度（又一个 builtin 命令）。

## 参考

- pi `AgentSession.reload()` API
- 交互反馈纪律：`AGENTS.md` §常见陷阱与纪律 §1
