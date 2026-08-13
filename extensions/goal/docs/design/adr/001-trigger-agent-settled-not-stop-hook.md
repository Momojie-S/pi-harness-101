# ADR-001: 触发用 `agent_settled` + 续行消息，非 Stop hook

## 状态

Proposed

## 背景

Claude Code 的 `/goal` 核心是一个 **session-scoped Stop hook**：模型每次"想停止"时，hook 拦截并跑裁判，判"未达成"则**阻止同一 turn 结束**（带 `stopHookActive` 旗标重跑）。这是"在停止边界拦截并阻止"的语义。

pi 的扩展机制里**没有 Stop hook**——没有任何事件能在"模型想结束 turn"时拦截并阻止结束。pi 有的事件：

- `turn_end`：每个 turn（一次 LLM 响应 + 工具调用）结束都触发。但模型可能还在工作中途（刚做完工具要进下个 turn），这时判停**太早**。
- `agent_end`：单次低层 agent run 结束。但 pi 可能自动重试 / compact 后继续，并非真正"想停"。
- `agent_settled`：agent 彻底空闲，pi 不会再自动继续。这是 pi 认定"工作结束"的时刻。

## 决策

监听 `pi.on("agent_settled", handler)` 作为裁判触发点；裁判判"未达成"时用 `pi.sendUserMessage(续行 prompt, { deliverAs:"followUp" })` 触发新 turn，实现循环。

## 备选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| **`agent_settled` + sendUserMessage**（采纳） | 语义最贴近"模型想停"；pi 原生支持；续行是显式消息可读性好 | "停后自动继续"而非"阻止停止"，agent 看到的是新 user 消息而非"停止被拒" |
| `turn_end` + 续行 | 每 turn 都判定，更敏感 | 模型还在中途（有工具调用要继续）时也会触发，误判"未达成"后发续行，干扰正常多 turn 工作 |
| `agent_end` + 续行 | 比 turn_end 粒度大 | pi 可能自动重试/compact 后继续，此时续行会和 pi 内部续行竞争 |
| 续行用 `context` 事件注入临时 message（不进 transcript） | transcript 干净（Codex 风格） | pi 的 custom message 持久化语义未文档化；context 事件每次 LLM 调用都触发需复杂状态管理；收益小（裁判不读 transcript 时无必要） |

## 后果

### 正面

- 用 pi 原生事件 + API，无 hack，无死锁风险（`agent_settled` 时 agent 已 idle，发消息触发新 turn 是预期行为）。
- 续行是普通 user message，TUI/web-console 都能正常渲染，人类可读。
- 裁判只在彻底空闲时跑一次/轮，比 Claude Code 每 stop 都跑更省（Claude Code 用廉价 Haiku 弥补，我们用"少跑"弥补）。

### 负面

- 与 Claude Code 的语义差异：不是"阻止停止"，而是"停后继续"。对用户**效果等价**（agent 会一直工作到完成），但实现路径不同。agent 感知到的是"又来一条用户消息"而非"我的停止被拒"——这其实更透明（续行 prompt 里带 gaps，agent 知道为什么继续）。
- 续行消息进 transcript，长 goal 会堆叠多条"继续"。靠"裁判只读最后回复"规避（见 ADR-003）。

## 参考

- Claude Code Stop hook 机制：`docs/research/goal/claude-code.md` §2-§5
- pi 事件：`extensions.md`（`agent_settled` / `turn_end` / `agent_end`）
- pi `sendUserMessage`：`extensions.md` + 示例 `send-user-message.ts`
- Codex 续行用 `try_start_turn_if_idle` + `InternalModelContextFragment`：`.temp/third-party/codex/codex-rs/ext/goal/src/runtime.rs` `continue_if_idle()`
