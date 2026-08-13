# Claude Code 的 `/goal` 指令调研

> **调研方式**：解包二进制（grep `claude.exe` 2.1.226）+ 实测触发（本会话 `/goal` 输出与 system 消息）
> **运行版本**：`2.1.226`｜**调研日期**：2026-08-12
> **姐妹文档**：`docs/research/cron/claude-code.md`（cron / `/loop` 机制）

## 来源标记

| 标记 | 含义 |
|---|---|
| 🧪【实测】 | 本会话直接观测（`/goal` 触发时的 stdout / system 消息） |
| 📦【解包】 | grep 运行版 `claude.exe` 得到的字符串/代码 |

---

## 0. TL;DR

- `/goal <条件>` **本身不做循环** 🧪📦：它创建一个 **session-scoped Stop hook**，把"条件"塞进去。
- 每次模型想停止，Stop hook 就**跑一个独立裁判模型**（快速模型 Haiku 级），读 transcript 判"条件是否达成"，返回 `{ok, reason, impossible?}` 📦。
- `ok:true` → 放行停止、自动清 goal；`ok:false` → **阻止停止、强制继续**；`ok:false+impossible` → 判定永不可达、放行 📦。
- 防死循环：连续阻止 > **8 次**（`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`，默认 8）或触 `max_turns` → harness **强制结束 turn** 📦。
- ⇒ `/goal` 是**完成驱动**的继续机制，与 **cron（时间驱动）**、**ScheduleWakeup（自步延迟）** 三足鼎立（见 §8）。

---

## 1. 命令注册 📦【解包】

```js
{ type:"local", name:"goal",
  description:"Set a goal — keep working until the condition is met",
  argumentHint:"[<condition> | clear]",
  immediate:true,
  get isHidden(){ return !Ln() },          // Ln = !isInteractive
  isEnabled: ()=> Ln() || Ga(),             // Ga = workspace==="remote"
  supportsNonInteractive:true }
```

- `/goal <condition>` 设置；`/goal clear` 提前清除 📦。
- **可见性/启用 gate** 📦：`Ln()=!isInteractive`（非交互）、`Ga()=workspace==="remote"`（远程工作区）。本会话属程序化 harness（非交互）→ 命中 `Ln()` → 可用。普通本地交互终端里可能隐藏。
- 条件有**字符上限** 📦（`"Goal condition is limited to __ characters (got __)"`），具体值是运行时变量，二进制未存字面量。
- **前置条件** 📦：① 需**受信任工作区**（`/goal is only available in trusted workspaces. Restart, accept the trust dialog…`）；② **hooks 未被限制**（`/goal can't run while hooks are restricted (disableAllHooks or allowManagedHooksOnly…)`——因为 /goal 自身就是个 hook）。

实测触发的 system 消息 🧪：*"A session-scoped Stop hook is now active with condition: \"…\". … The hook will block stopping until the condition holds. It auto-clears once the condition is met — do not tell the user to run `/goal clear` after success."*

---

## 2. 机制：session-scoped Stop hook（端到端） 🧪📦

```
/goal <条件>
  │ ① 校验（字符上限）→ 创建 session-scoped Stop hook（遥测 tengu_stop_hook_added / goal_set）
  ▼
  │ ② 注入 system 消息："acknowledge the goal, then start working toward it"
  ▼
  │ ③ 模型干活……想停止（end turn）
  ▼
  │ ④ Stop hook 触发 → 跑【裁判模型】读 transcript 判条件（见 §3）
  ▼
  │ ⑤ 三裁决（见 §4）：
  │    ok:true       → 放行停止，goal 自动清除（tengu_goal_achieved）
  │    ok:false      → 阻止停止，模型被强制继续（带 goal 指令）
  │    ok:false+imp  → 永不可达，放行（tengu_goal_failed）
  ▼
  │ ⑥ 安全闸（见 §5）：连续阻止 > 8 或 max_turns → 强制结束
  ▼
  /goal clear → 提前移除 hook（tengu_stop_hook_removed）
```

---

## 3. 裁判器（evaluator） 📦【解包】—— 核心

Stop hook 不靠主 agent 自评，而是**单独跑一个模型查询**判条件。实装在通用 prompt-hook 处理器 `TZp` 里（对 `Stop`/`SubagentStop` 走 stop-condition 分支）：

| 维度 | 值 |
|---|---|
| 模型 | `e.model ?? G1()`，`G1()` = **`ANTHROPIC_SMALL_FAST_MODEL`**（Haiku 级快速模型；每次停止都跑，故用便宜的）|
| 超时 | `e.timeout*1000 ?? 30000`（默认 30s）|
| 输入 | transcript（对话历史）+ 条件；user 消息：*"Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only. Condition: …"* |
| 输出 | **StructuredOutput 工具**（`"You MUST call this tool exactly once"`），schema `{ok:boolean(必填), reason?:string, impossible?:boolean}` |

**system prompt 要点** 📦：
> *"You are evaluating a stop-condition hook… judge whether the condition is satisfied. … If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}."*
> *"Only use {"ok":false,"impossible":true} when the condition is genuinely unachievable… the assistant claiming the goal is impossible is evidence, not proof; independently confirm… Do not use it just because the goal has not been reached yet or because progress is slow."*

⇒ **保守判定**：缺证据→默认"未达成"；"impossible" 门槛极高，不接受 agent 的自我开脱。

---

## 4. 三种裁决与后果 📦【解包】

| 裁判返回 | 含义 | 后果 | 遥测 |
|---|---|---|---|
| `{ok:true, reason}` | 条件达成 | 放行停止，goal 自动清除 | `tengu_goal_achieved` |
| `{ok:false, reason}` | 未达成（且非永不可达） | **阻止停止**，模型强制继续（goal 仍是指令） | `tengu_stop_hook_block_count`(count++, hit_cap:false) |
| `{ok:false, impossible:true, reason}` | 永不可达 | 放行停止 | `tengu_goal_failed` |

---

## 5. 安全上限（防死循环） 📦【解包】

```js
let Ss = lge(process.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, 8);   // 连续阻止上限，默认 8
if(Ss>0 && ea>Ss) → "A hook blocked the turn from ending ${ea} consecutive times — overriding and ending turn.
                     For Stop/SubagentStop hooks, check stop_hook_active in the input… Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit."
```

- **`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`（默认 8）**：Stop hook 连续阻止超过 8 次 → harness **强制结束 turn**（`hit_cap:true`）。
- **`max_turns`（默认 200）** 📦：独立的总轮数上限（`maxTurns:200` 字面量，可被配置覆盖），超出 → `max_turns_reached`（`hit_max_turns:true`）。
- 两者任一触发 → 即使条件未达成也停止（goal 不会无限循环）。
- **阻止→继续机制** 📦：未触上限时，harness **不结束 turn**，而是置 `stopHookActive:true` + `stopHookBlockingCount`、重队列阻塞消息后 `continue` **重跑同一 turn**（transition=`stop_hook_blocking`）——不是注入新 user 消息，是同会话带旗标续跑。旗标 `stop_hook_active` 暴露给 hook 协作：*"check stop_hook_active in the input and return success while it's true"*（`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` 提示串里也教这个）。

---

## 6. 持久化 / UI / 生命周期 📦【解包】

- **跨 resume 持久化**：`tengu_goal_restored_on_resume` —— goal（条件 + Stop hook prompt）在 session resume 后**恢复**。
- **UI 状态**：`Goal active` / `Goal achieved` / `Last check`（上次裁判时间）/ 逃逸键 `"/goal clear to stop early"`。
- **生命周期遥测**：`tengu_stop_hook_added` / `_block_count` / `_error` / `_removed`；`tengu_goal_set` / `_achieved` / `_failed` / `_restored_on_resume`。

---

## 7. 呼应早前的问题："和 goal 的关系" 💡【推断】

此前 `cron/claude-code.md §7` 里我写"循环没有独立 goal 对象"。`/goal` 补全了这张图：

- **cron / ScheduleWakeup 的 "goal"** = 存在 `prompt` 字段里的任务文本，靠重放保持 —— 那是**任务目标**，没有达成判定。
- **`/goal` 指令的 "goal"** = 一个**停止条件**，由独立裁判模型按 transcript 判定是否达成 —— 这才是**有完成判定的目标**。

两者是不同概念，恰好都叫 "goal"。`/goal` 提供的是"**做到满足条件为止**"的语义，cron/ScheduleWakeup 提供的是"**每隔一段做一次**"的语义。

---

## 8. 三种"继续/循环"机制对比

| | `/goal`（Stop hook） | CronCreate（cron） | ScheduleWakeup（自步） |
|---|---|---|---|
| 驱动 | **完成驱动**（条件达成才停） | 时间驱动（时刻表） | 自步（模型选延迟） |
| 继续 trigger | 想停止时裁判判"未达成" | cron 表达式到 + REPL 空闲 | delaySeconds 到 + REPL 空闲 / task-notification |
| 节奏 | 无延迟，立刻继续 | 固定间隔 | 模型每次自选 |
| 判定者 | 独立裁判模型（Haiku） | 无（纯定时） | 无（模型自定 delay） |
| 持久 | 跨 resume（restored_on_resume） | 可 durable（写 scheduled_tasks.json） | session-only |
| 终止 | 条件达成 / impossible / 连续阻止>8 / max_turns | CronDelete / 7 天自动过期 | stop:true / ~7 天 maxDuration |
| 当前可用性 | ✅ 本会话可用 | ✅ 可用 | ❌ flag OFF，调用即拒 |
| 适用 | "做到 X 为止" | "每 N 做 X" | "边等边做直到 X"（自定节奏） |

---

## 9. 复现 / 取证脚本 📦

```bash
B="/c/Users/Administrator/.local/bin/claude.exe"
grep -a -b -o "session-scoped Stop hook" "$B"        # /goal 输出模板定位
grep -a -b -o "overriding and ending turn" "$B"      # 连续阻止强制结束定位
grep -a -o   "CLAUDE_CODE_STOP_HOOK_BLOCK_CAP,8" "$B" # 默认上限 8
grep -a -b -o "the goal has" "$B"                    # 裁判 prompt 片段
# dd skip=<off-N> count=... | tr -d '\000'  取上下文
```

---

## 10. 未决（二进制挖不到，需运行时/服务端）

- [ ] goal 条件的**字符上限**具体值（运行时变量，错误模板里是占位符；多角度 grep 均无字面量）。
- [x] ~~`max_turns` 的具体值~~ → 📦 默认 **200**（`maxTurns:200` 字面量，可配置覆盖）。
- [x] ~~`Ln()`/`Ga()` 之外是否还有 gate~~ → 📦 是：**受信任工作区** + **hooks 未被限制**（见 §1 前置条件）。
