# OpenClaw 的 `/goal` 指令调研

> **调研方式**：读 `openclaw/openclaw` 仓库源码（`src/config/sessions/goals.ts` + `src/agents/tools/goal-tools.ts` + 文档）
> **仓库版本**：`2a8b322e`（2026-08-13）｜**调研日期**：2026-08-13
> **姐妹文档**：`goal/codex.md`（OpenClaw 克隆的协议源头）、`goal/hermes.md`、`goal/claude-code.md`

## 来源标记

| 标记 | 含义 |
|---|---|
| 📦【源码】 | 读仓库源码（`src/`）确认 |
| 📄【文档】 | 读 `docs/` 确认 |

---

## 0. TL;DR

- OpenClaw 的 `/goal` 是 **Codex ThreadGoal 协议的「忠实克隆」** 📦📄：同样的三个模型工具（`get_goal`/`create_goal`/`update_goal`）、同样的六态状态机、同样的 `blocked` 需 ≥3 次连续规则、同样的 `token_budget`。
- **但 OpenClaw 自家 src 层是「纯状态管理」** 📦：没有 continuation loop、没有独立 judge。goal = 持久化的 session-scoped 状态 + 每轮注入一行 context 提醒模型。完成靠**模型自报**（`update_goal`），续 turn 靠**用户/模型的自然多轮交互**（或委托 codex app-server runtime 时由 codex 原生驱动）。
- **`continuationTurns` 字段存在但无 src 层 loop 逻辑** 📦——是预留给 codex app-server runtime 同步用的计数槽。
- **定位**：OpenClaw 把 goal 当「**跨 surface 共享的目标状态**」，由各 runtime 按自身方式推进；OpenClaw 负责状态持久化、token 记账、跨 channel 同步，不负责「自动续跑」。

---

## 1. 谱系 📄📦

OpenClaw 与 Codex 同属 OpenAI 生态（OpenClaw 能 `attach` Claude Code、跑 codex app-server session、跑 Copilot）。CHANGELOG（PR #100468）描述其 `/goal` 📄：

> *"An active `/goal` now keeps guiding later turns and survives compaction, queues, and interruptions until the goal is paused, completed, blocked, or limited."*

状态词（paused/completed/blocked/limited）与 Codex 状态机一字不差——这是协议同源的强信号。源码进一步坐实 📦（见 §2）。

---

## 2. 三个模型工具 = Codex 协议克隆 📦【源码】（`src/agents/tools/goal-tools.ts`）

工具签名、约束、甚至工具 description 措辞都和 Codex 的 `ext/goal/src/spec.rs` 高度一致：

| 工具 | OpenClaw（typebox schema） | 与 Codex 对比 |
|---|---|---|
| `get_goal` | 无参，返回 goal 快照（status/objective/token 用量） | 同 |
| `create_goal` | `objective`（必填）+ `token_budget`（可选正整数）；*"only explicit user/system request"*；已有 goal 则失败 | 同（description 措辞几乎逐字一致） |
| `update_goal` | `status`（仅 `complete`\|`blocked`）+ 可选 `note` | 同；blocked 规则描述 *"same blocker 3+ consecutive goal turns"* 一字不差 |

`update_goal` 的工具 description 📦：
> *"Update the session goal status (complete \| blocked)… complete only achieved. blocked only same blocker 3+ consecutive goal turns; never ordinary difficulty/polish. Updating a goal does not reply to the user; provide the requested final response afterward."*

⇒ OpenClaw 直接复用了 Codex 的工具语义与 prompt 约束。区别仅在实现语言（TS typebox vs Rust）和小细节（OpenClaw 多了 `note` 字段）。

---

## 3. 状态机 = Codex 克隆 📦📦【源码 + 文档】

`docs/tools/goal.md` 列的状态 📄 与 `src/config/sessions/goals.ts` 的 `SessionGoal` 状态机 📦 完全对应：

```
active → paused / blocked / budget_limited / usage_limited / complete
```

- `budget_limited` 📦：token 用量达 `token_budget` → 转 `budget_limited`；`/goal resume` 重开预算窗口（在当前 fresh token 计数重置 baseline）。
- `usage_limited` 📄：*“reserved for a future usage-limit stop state”*（预留态，目前未实装触发）。
- `complete` 是终态 📄：要先 `/goal clear` 才能再建。
- `/new`、`/reset` 清当前 goal 📄（因为它们重置 session context）。

**token 记账细节** 📦（`goals.ts`）：预算从 goal 创建时刻的 fresh token 计数起算；若 session 只有 stale token 快照，OpenClaw 等下一个 fresh 快照再做 baseline，避免 goal 之前的消耗算到它头上。

---

## 4. 关键差异：无 continuation loop、无独立 judge 📦【源码】

这是 OpenClaw 与 Codex/Hermes 最大的区别。全仓搜索（`src/` + `extensions/codex/src/`）的结论 📦：

- **src 层无 `judge_goal` / 任何独立裁判调用**。
- **src 层无 continuation loop 驱动**（无 `continue_if_idle`、无 `evaluate_after_turn`、无自动 `run_conversation` 续 turn）。
- `goals.ts` 有 `continuationTurns: 0` 字段 📦，但**状态机里没有 increment / loop / 判定逻辑**——它是预留给 codex app-server runtime 同步回填的计数槽。

⇒ OpenClaw 自家 runtime 下的 `/goal` 语义是：

1. **持久状态**：goal 存 session store（session-key 维度，跨 channel/进程同步）。
2. **每轮注入 context line** 📄：每个有 active goal 的 user/chat turn 附一行 user-role 提醒：
   > *"Active goal: <objective> — advance; keep active until fully achieved; block only after the same blocker on 3 consecutive turns; after update_goal, provide the requested visible final."*
   （长 objective 会被截断保持紧凑；paused/blocked/limited/complete 的 goal 不注入，让用户停顿保持生效。）
3. **模型自报完成**：模型自己决定何时 `update_goal(complete)`。

**没有「自动续 turn」**——OpenClaw 不像 Codex 那样在 idle 时主动开下一 turn。推进靠：用户继续发消息，或模型在当前 turn 内继续工作。goal 的作用是**让目标在多轮间保持可见 + 引导模型行为**，而非自动驱动循环。

---

## 5. 委托 codex app-server runtime 时才有 loop 📦📄

OpenClaw 可选 codex app-server runtime（`extensions/codex/`）跑 turn。此时 📄（参考 Hermes 的 codex-app-server-runtime 文档，OpenClaw 同生态）：

- turn 交给 codex 跑 → codex 原生的 `continue_if_idle` continuation loop 生效（见 `codex.md` §3）。
- ThreadGoal 协议（`app-server-protocol`）天然对接——OpenClaw 的 goal 状态与 codex 的 ThreadGoal 同步。
- `continuationTurns` 字段在此场景被 codex 续 turn 时回填。

⇒ OpenClaw 的 `/goal` 是**「runtime 无关的 goal 状态层」**：自家 runtime 下是「状态 + 提醒」的轻量语义；codex runtime 下继承 codex 的完整 Ralph loop（模型自报 + 自动续 turn）。设计意图是把 goal 当**可移植的会话状态**，而非绑死某一种循环引擎。

---

## 6. 命令面 📄【文档】

| 命令 | 作用 |
|---|---|
| `/goal` / `/goal status` | 显示当前 goal |
| `/goal start <objective>`（或 `set`/`create`/直接写文本） | 建 goal |
| `/goal edit <objective>` | 改写目标，状态与 token 记账不动 |
| `/goal pause [note]` / `resume [note]` | 暂停/恢复 |
| `/goal complete [note]`（`done`） | 标完成 |
| `/goal block [note]`（`blocked`） | 标阻塞 |
| `/goal clear` | 移除 |

- `start` 不接 token-budget flag 📄——预算只能通过模型工具 `create_goal` 设（用户命令层不暴露）。
- goal 状态绑 session-key 📄，不绑 transport——两个 surface 共享一个 session-key 看到同一个 goal。
- goal **不是交付指令** 📄：不强制回复走某 channel、不改 queue 行为、不批准工具、不调度工作。

---

## 7. UI / TUI 呈现 📄【文档】

- **Web Control UI**：composer 上方的 pill——状态图标 + 标签（如 `Pursuing goal`）+ 截断 objective + 实时计时。内联：铅笔（`/goal edit`）、暂停/恢复、垃圾桶（`/goal clear`）、chevron 展开看全 objective/note/token/elapsed。
- **TUI footer**：`Pursuing goal (12k/50k)` / `Goal paused (/goal resume)` / `Goal blocked (/goal resume)` / `Goal hit usage limits` / `Goal unmet (50k/50k)` / `Goal achieved (42k)`。

⇒ OpenClaw 在 goal 的**可见性**上做得最细（pill + footer + 跨 surface），呼应它「goal = 可见共享状态」的定位。

---

## 8. 在 Ralph loop 家族里的定位

| 维度 | OpenClaw |
|---|---|
| 完成判定 | **模型自报**（update_goal，克隆 Codex） |
| 独立裁判 | ❌ 无 |
| 续 turn 引擎 | ❌ 自家 runtime 无；委托 codex runtime 时继承 codex 的 idle gate |
| 预算 | token_budget（克隆 Codex 的 token 记账） |
| 防死循环 | blocked ≥3 次连续 + 预算上限 |
| 持久 | ✅ session store（session-key 维度，跨 channel/进程） |
| 形态 | TS（`src/config/sessions/goals.ts`）+ 模型工具 + 命令 + UI |

> OpenClaw 是家族里的「**协议搬运工 + 状态层**」：它原样采用 Codex 的 ThreadGoal 工具与状态机，但不自带循环引擎——把「怎么推进 goal」留给 runtime（自家=自然多轮，codex=原生 loop）。它最大的贡献是把 goal 做成**跨 surface 可见、跨 runtime 可移植的会话状态**，而非某种特定的循环策略。
