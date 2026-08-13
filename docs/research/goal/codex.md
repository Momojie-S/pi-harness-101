# Codex CLI 的 `/goal` 指令调研

> **调研方式**：读 `openai/codex` 仓库源码（`codex-rs/ext/goal/` 扩展 + `app-server-protocol` 协议）
> **仓库版本**：`fe614a6`（2026-08-13）｜**调研日期**：2026-08-13
> **姐妹文档**：`goal/hermes.md`（Hermes 借鉴 Codex 后加了独立 judge）、`goal/openclaw.md`（OpenClaw 克隆 Codex 协议）、`goal/claude-code.md`（平行演化的另一支）

## 来源标记

| 标记 | 含义 |
|---|---|
| 📦【源码】 | 读仓库源码（`codex-rs/`）确认 |

---

## 0. TL;DR

- Codex 的 `/goal` 是 **Ralph loop 家族的源头**——Hermes、OpenClaw 的 `/goal` 都直接 credit 它。Eric Traut（OpenAI）在 Codex CLI 0.128.0 引入。
- **完成判定靠「模型自报」，没有独立裁判模型** 📦：模型通过 `update_goal(status="complete"|"blocked")` 工具自己标记。与 Claude Code 的「独立 Haiku 裁判读 transcript」是**两套不同范式**。
- **continuation loop（自动续 turn）** 📦：goal active 且 thread idle 时，runtime 注入 continuation steering prompt（`goals/continuation.md` 模板）并 `start_turn_if_idle` 自动开下一 turn——不需要用户再发消息。
- **完成审计靠 prompt 严格化** 📦：`continuation.md` 里有大段「Completion audit / Blocked audit」指令，教模型把完成当「未证」，逐条要求 evidence，对标 Claude Code 裁判的保守默认。
- **预算 = token_budget（可选）+ time** 📦，不是 turn 数；状态机六态（Active/Paused/Blocked/UsageLimited/BudgetLimited/Complete）；blocked 需同一阻塞条件重复 ≥3 次连续 goal turn。
- **跨 resume 持久化** 📦（`restore_after_resume`）。

---

## 1. 实现位置与形态 📦【源码】

Codex 的 goal 不是 CLI slash 命令，而是 **app-server 层的一套 ThreadGoal 协议 + Rust 扩展**：

```
codex-rs/
├── ext/goal/                          # goal 扩展（Rust crate）
│   ├── src/
│   │   ├── spec.rs        # 三个 Responses API 工具定义（get/create/update_goal）
│   │   ├── tool.rs         # 工具执行器（create/update 的实际逻辑）
│   │   ├── steering.rs     # continuation/budget/objective prompt 渲染
│   │   ├── runtime.rs      # GoalRuntimeHandle：continuation loop 驱动 + 状态机
│   │   ├── accounting.rs   # token/time 预算记账
│   │   ├── analytics.rs / metrics.rs / events.rs  # 遥测
│   ├── templates/goals/
│   │   ├── continuation.md          # ★ 自动续 turn 的 steering prompt（含完成审计）
│   │   ├── budget_limit.md          # 预算耗尽时的提示
│   │   └── objective_updated.md     # 目标被改写时的提示
│   └── tests/             # accounting.rs / goal_extension_backend.rs
└── app-server-protocol/
    └── src/protocol/v2/thread.rs     # ThreadGoal / ThreadGoalSet/Get/Clear 协议
    └── schema/{json,typescript}/v2/  # ThreadGoal* 协议 schema（给 IDE/客户端）
```

> 关键：goal 逻辑在 **Rust 扩展 + app-server 协议**里，不是 CLI 层。这意味着任何接 Codex app-server 的客户端（OpenClaw、Hermes 的 codex-runtime）都能拿到同一套 ThreadGoal 协议。

---

## 2. 三个模型工具 📦【源码】（spec.rs）

模型可见三个 function tool（Responses API 格式）：

| 工具 | 作用 | 关键约束 |
|---|---|---|
| `get_goal` | 读当前 goal（status / objective / token 用量 / 剩余预算） | 无参 |
| `create_goal` | 建新 goal（带可选 `token_budget`） | **仅用户/系统明确要求时才建**，"do not infer goals from ordinary tasks"；已有未完成 goal 则失败 |
| `update_goal` | 标 `complete` 或 `blocked` | **只能标这两个终态**；pause/resume/budget 是用户/系统控制，模型无权 |

`update_goal` 的工具 description（即喂给模型的 prompt）极其严格 📦：

> *"Set to `complete` only when the objective is achieved and no required work remains. Set to `blocked` only after the same blocking condition has recurred for at least three consecutive goal turns… Do not use `blocked` merely because the work is hard, slow, uncertain, incomplete… Do not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work."*

⇒ **信任偏向的控制在 prompt**：不是靠独立裁判，而是靠给模型自己下严格的自审指令（见 §4 的 continuation.md）。

---

## 3. Continuation loop（自动续 turn） 📦【源码】（runtime.rs）

这是 Ralph loop 的「引擎」。核心是 `GoalRuntimeHandle::continue_if_idle`：

```
每轮结束、thread 进入 idle
  │
  ▼ continue_if_idle()
  │ ① 持 goal_state_lock（防 set/clear 在读后、续 turn 前改 goal）
  │ ② 检查 continuation deferral（被显式延迟则跳过）
  │ ③ 读当前 goal；若 status != Active → clear active goal，返回
  │ ④ 渲染 continuation steering item（steering.rs → continuation.md 模板）
  │ ⑤ thread.start_turn_if_idle(TurnInput::ResponseItem(item))
  │     → 若 idle 且可提交 → 自动开下一 turn（无需用户发消息）
  │     → 若被拒（NotSubmitted）→ debug 日志，静默跳过
  ▼
下一 turn 用 continuation prompt 作为 ContextualUserFragment 跑
```

- **continuation prompt 是「InternalModelContextFragment」** 📦（`steering.rs` 的 `goal_context_input_item`）——注入为内部模型上下文片段，不是普通 user 消息。
- **objective 被改写时的 steering** 📦：`apply_external_goal_set` 检测到 objective 变化 → `objective_updated_steering_item` 注入到**正在跑的 turn**（`inject_if_running`），让模型立刻知道目标变了。
- **预算耗尽的 steering** 📦：`budget_limit_steering_item` 在预算触顶时注入，把 goal 推到 `BudgetLimited` 状态。

> 对比 Claude Code：Codex 的 continuation 是「**idle 时主动续 turn**」，Claude Code 是「**想停止时 Stop hook 拦截**」。触发点不同（idle gate vs stop gate），但都是「不靠用户再发消息就继续」。

---

## 4. continuation.md —— 完成审计的 prompt 核心 📦【源码】

这是 Codex `/goal` 最有信息量的文件（`ext/goal/templates/goals/continuation.md`）。它既是续 turn 的 steering，也是模型自报完成前的「自审清单」。要点：

**目标持久化语义**（防模型缩范围）：
> *"This goal persists across turns. Ending this turn does not require shrinking the objective… Keep the full objective intact. If it cannot be finished now, make concrete progress toward the real requested end state… Completion still requires the requested end state to be true and verified."*

**基于证据**（防模型凭记忆）：
> *"Use the current worktree and external state as authoritative. Previous conversation context can help locate relevant work, but inspect the current state before relying on it."*

**保真度**（防模型做「更小更安全的子集」冒充完成）：
> *"Do not substitute a narrower, safer, smaller, merely compatible, or easier-to-test solution… An edit is aligned only if it makes the requested final state more true."*

**Completion audit**（对标 Claude Code 裁判的「缺证据=未完成」保守默认）：
> *"Before deciding that the goal is achieved, treat completion as unproven and verify it against the actual current state… For every explicit requirement… identify the authoritative evidence that would prove it, then inspect the relevant current-state sources… Treat uncertain or indirect evidence as not achieved… The audit must prove completion, not merely fail to find obvious remaining work."*

**Blocked audit**（防模型过早报死）：
> *"Do not call update_goal with status `blocked` the first time a blocker appears. Only use status `blocked` when the same blocking condition has repeated for at least three consecutive goal turns… Never use status `blocked` merely because the work is hard, slow, uncertain, incomplete."*

> ⇒ **Codex 把「保守判定」从独立裁判搬到了 prompt**：没有第二个模型，但用极强的自审指令逼主模型保守。这是 Ralph loop 的「廉价版保守判定」——省掉一次裁判模型调用，代价是依赖主模型遵从指令。

---

## 5. 状态机与预算 📦【源码】

**六态状态机**（`state/src/model/thread_goal.rs` 的 `ThreadGoalStatus`）：

```
                          create_goal
                              │
                              ▼
                          ┌────────┐  update_goal(complete)   ┌──────────┐
              ┌───────────│ Active │ ───────────────────────▶ │ Complete │(终态)
              │           └────────┘                          └──────────┘
              │              │  │
   用户 pause │              │  │ update_goal(blocked, ≥3次)
              │              │  ▼
              │              │ ┌────────┐
              │              │ │ Blocked│── /goal resume ──▶ Active
              │              │ └────────┘
              │              │
              │   预算触顶   ▼
              └───────── ┌──────────────┐
                         │ BudgetLimited │── resume(新预算窗口) ──▶ Active
                         └──────────────┘
              ┌──────────────┐
              │ UsageLimited │── resume ──▶ Active（用量上限，预留态）
              └──────────────┘
              ┌────────┐
              │ Paused │── resume ──▶ Active（用户主动暂停）
              └────────┘
```

**预算记账**（`accounting.rs`）：
- `token_budget`（create_goal 时可选设置）+ `time_used_seconds`（墙钟）。
- 每轮结束 `account_active_goal_progress` 把本轮 token/time delta 计入 goal。
- 触顶 → `BudgetLimited`（goal 不删，只是停 pursuit，等 resume 重开预算窗口）。
- `GoalAccountingMode`：`ActiveOnly` / `ActiveOrComplete` / `ActiveOrStopped`——控制哪些状态下还记账。

**外部 mutation 的安全** 📦（`prepare_external_goal_mutation`）：用户 `/goal` 改 goal 前，runtime 先把当前 turn 的进度记账，再清 active goal 标记，防并发竞态。

---

## 6. 跨 resume 持久化 📦【源码】

`restore_after_resume` 📦：session resume 后读持久化的 goal，若 status==Active 则重新标记 idle goal active 并 `metrics.record_resumed`；否则 clear。goal 存在 `codex_state`（state DB）里，跨进程存活。

---

## 7. app-server 协议（ThreadGoal） 📦【源码】

给 IDE/客户端的 JSON-RPC 协议（`protocol/v2/thread.rs`）：

| 方法 | 作用 |
|---|---|
| `ThreadGoalSet` | 用户/客户端设 goal（params: objective） |
| `ThreadGoalGet` | 读当前 goal |
| `ThreadGoalClear` | 清 goal |
| `ThreadGoalUpdated`（notification） | goal 变更推送（带 turn_id） |
| `ThreadGoalCleared`（notification） | goal 清除推送 |

> 这套协议是 OpenClaw 能「克隆 Codex goal」的基础——OpenClaw 直接对接 Codex app-server 时，ThreadGoal 协议天然可用。

---

## 8. 在 Ralph loop 家族里的定位

| 维度 | Codex（源头） |
|---|---|
| 完成判定 | **模型自报**（update_goal 工具，prompt 自审） |
| 独立裁判 | ❌ 无（靠 continuation.md 的强自审指令） |
| 续 turn 引擎 | ✅ idle gate（continue_if_idle → start_turn_if_idle） |
| 预算 | token_budget（可选）+ time |
| 防死循环 | blocked ≥3 次连续 + 预算上限 |
| 持久 | ✅ state DB + restore_after_resume |
| 形态 | Rust 扩展 + app-server 协议（非 CLI 命令） |

> Codex 是 Ralph loop 的「**原型机**」：continuation loop + 模型自报 + prompt 保守化。Hermes 在此基础上加了**独立 judge 模型**（见 hermes.md），OpenClaw 则**直接克隆协议**但去掉了自动续 turn（见 openclaw.md）。
