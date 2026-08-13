# Hermes 的 `/goal` 指令调研

> **调研方式**：读 `NousResearch/hermes-agent` 仓库源码（`hermes_cli/goals.py` 2156 行 + 文档 + 配置）
> **仓库版本**：`fa83af3`（2026-08-13）｜**调研日期**：2026-08-13
> **姐妹文档**：`goal/codex.md`（Hermes 借的 loop 引擎）、`goal/claude-code.md`（Hermes 借的独立裁判思路）、`goal/openclaw.md`

## 来源标记

| 标记 | 含义 |
|---|---|
| 📦【源码】 | 读仓库源码（`hermes_cli/`、`gateway/`）确认 |
| 📄【文档】 | 读 `website/docs/` 确认 |

---

## 0. TL;DR

- Hermes 的 `/goal` 是 **Ralph loop 家族里最丰富的实现**——文档明确写 *"our take on the Ralph loop, directly inspired by Codex CLI 0.128.0's `/goal` by Eric Traut"* 📄。
- **融合两家** 📦：续 turn 引擎借自 **Codex**（continuation prompt 喂回 `run_conversation`），完成判定借自 **Claude Code** 风格（**独立辅助模型 judge**，而非模型自报）。
- **judge 三 verdict** 📦：`done` / `continue` / `wait`（wait 有 session/pid/seconds 三种「停车」方式，park loop 不烧 turn）。
- **fail-open 设计** 📦：judge transport 错误 → 默认 `continue`（不卡死），但跟踪连续失败次数，超阈值 auto-pause（防永久坏配置烧光预算）。
- **四道额外护栏**（Hermes 独有，Codex/Claude Code 都没有）📦：
  - **Completion contracts**（5 字段结构化「完成契约」，judge 严格按 verification 判 done）
  - **`/subgoal`**（中途追加验收条件）
  - **Quality gates**（确定性 shell 命令，judge 之前跑，失败短路 judge）
  - **`/goal wait`**（手动把 loop 停在后台进程上）
- **max_turns=20** 📦（turn budget 兜底，config 可配）。

---

## 1. 谱系与定位 📄【文档】

`website/docs/user-guide/features/goals.md` 开篇即声明血缘：

> *"It's our take on the **Ralph loop**, directly inspired by Codex CLI 0.128.0's `/goal` by Eric Traut (OpenAI). The core idea — keep a goal alive across turns and don't stop until it's achieved — is theirs. The implementation here is independent and adapted to Hermes' architecture."*

`config_defaults.py` 的注释进一步定位 📦：

> *"Goals — persistent cross-turn goals (Ralph-style loop). After every turn, a lightweight judge call asks the auxiliary model whether the active /goal is satisfied by the assistant's last response. If not, Hermes feeds a continuation prompt back into the same session and keeps working… Judge failures fail OPEN (continue) so a flaky judge never wedges progress — the turn budget is the real backstop."*

⇒ **Hermes = Codex 的 loop 骨架 + Claude Code 的独立裁判血肉 + 四道自家护栏**。它同时是「Ralph loop 家族」和「独立裁判家族」的交集点。

---

## 2. 核心循环 📦【源码】（`goals.py` 的 `GoalManager.evaluate_after_turn`）

每个 live session 持一个 `GoalManager`（CLI 和 gateway 各一份）。每轮结束后 caller 调 `evaluate_after_turn(last_response)`，返回 decision dict（`should_continue` + `continuation_prompt`）驱动下一 turn：

```
每轮结束
  │
  ▼ evaluate_after_turn(last_response, background_processes)
  │
  │ ① Wait barrier 检查：parked（pid/session/seconds 未到期）
  │     → should_continue=False，【不烧 turn、不调 judge】，返回 "⏳ parked"
  │
  │ ② turns_used += 1（user_initiated 和 continuation 都计数，都消耗预算）
  │
  │ ③ Quality gates（judge 之前）：
  │     gate 全过 → 继续
  │     某 gate 失败 → should_continue=True + gate 失败 prompt（gate 输出驱动下一 turn）
  │     gate 耗尽 retries(max_retries=3) → status=paused，"⏸ quality gate exhausted"
  │     （gate 失败的 continuation 也受 max_turns 约束）
  │
  │ ④ judge_goal() —— 调 auxiliary.goal_judge 模型，返回 verdict
  │     跟踪 consecutive_parse_failures / consecutive_transport_failures
  │
  │ ⑤ 按 verdict 分支：
  │     done    → clear goal，"✓ Goal achieved: <reason>"
  │     wait    → set barrier（session/pid/seconds），park，turn 已计但无 continuation
  │     continue→ 若 turns_used >= max_turns → paused（预算耗尽）
  │               否则 → should_continue=True + next_continuation_prompt()
  │
  ▼
caller: should_continue=True → run_conversation(continuation_prompt) 开下一 turn
```

> 对比 Codex：Codex 是 `continue_if_idle`（idle gate 主动续），Hermes 是 `evaluate_after_turn` 返回 decision 后 caller 续（turn gate）。Hermes 多了 judge 这一层（Codex 是模型自报）。对比 Claude Code：Claude Code 是 Stop hook 拦截（stop gate），Hermes 是 turn 后判定（turn gate）。

---

## 3. 独立 judge（auxiliary.goal_judge） 📦【源码】—— 核心

这是 Hermes 区别于 Codex（模型自报）的关键。`judge_goal()` 函数：

| 维度 | 值 |
|---|---|
| 模型 | `auxiliary.goal_judge` 配置（provider auto，默认空=用快速廉价模型）；**独立于主模型** |
| 超时 | `DEFAULT_JUDGE_TIMEOUT` |
| 输入 | goal 文本 + **assistant 上一轮 response**（截断 `_JUDGE_RESPONSE_SNIPPET_CHARS`）+ background_processes 快照 + 当前时间 |
| 输出 | 一行 JSON：`{"verdict":"done\|continue\|wait", "reason":"...", ...}` |
| temperature | 0（确定性） |
| max_tokens | `_goal_judge_max_tokens()`（默认覆盖 reasoning+verdict） |

**judge 的 system prompt** 📦 定义三种 verdict（`JUDGE_SYSTEM_PROMPT`）：
- **DONE**：response 明确确认完成 / 展示了最终交付物 / 解释了不可达或需用户介入（后者也算 done，reason 描述阻塞）。
- **WAIT**：未完成，但下一步该等异步工作，而不是再戳 agent。**仅当 agent 进度真的被某个自跑的东西门控**（CI/build/test/deploy 还在跑，或 rate-limited/backoff）才选——选了就 park loop、不烧 turn。明确禁止 *"Do NOT pick WAIT just because work remains"*。
- **CONTINUE**：未完成且有具体下一步可做。**存疑时的默认**。

**judge prompt 的保守化**（对标 Claude Code 裁判）：
- 带 contract 时 📦：`"DONE only when the Verification criterion is satisfied AND the response shows concrete evidence (command result, file contents excerpt, test/benchmark output) — not a claim like 'done' or 'all tests pass' without evidence."`
- 带 subgoals 时 📦：`"For each numbered criterion, find concrete evidence… Do not accept generic phrases like 'all requirements met'… If ANY criterion lacks specific evidence, return CONTINUE."`

⇒ **保守默认 + 结构化证据要求**：和 Claude Code 裁判的「缺证据=未完成」一脉相承，但 Hermes 把它落到具体 contract/subgoal 的逐条核对。

---

## 4. fail-open 与失败追踪 📦【源码】

`judge_goal()` 的返回是 `(verdict, reason, parse_failed, wait_directive, transport_failed)` 五元组，刻意区分两类失败 📦：

| 失败类型 | 触发 | verdict | 后续处理 |
|---|---|---|---|
| **transport_failed** | API 连不上（401/timeout/DNS） | `continue`（fail-open） | `consecutive_transport_failures++`，超阈值 auto-pause（防永久坏配置烧光预算） |
| **parse_failed** | API 通了但输出非 JSON | `continue`（fail-open） | `consecutive_parse_failures++`，超阈值 auto-pause |
| 正常 | 解析成功 | 实际 verdict | 计数器清零 |

设计哲学 📦：*"a broken judge must not wedge progress; the turn budget is the backstop."* 临时网络抖动（parse_failed=False）不会触发 auto-pause（只 reset 计数），只有「永久坏」（连续 transport 失败）或「坏 judge 模型」（连续 parse 失败）才 pause。

---

## 5. 四道额外护栏（Hermes 独有） 📦📦📦📦

### 5.1 Completion contracts（结构化完成契约）

`GoalContract` 五字段，全可选 📦：

| 字段 | 含义 |
|---|---|
| `outcome` | done 时必须为真的单一终态 |
| `verification` | **证明** outcome 的具体测试/命令/产物（必须可机械检查） |
| `constraints` | 不能破坏/回归的东西 |
| `boundaries` | 在范围内的文件/目录/工具 |
| `stop_when` | 该停下来问用户的条件 |

设置方式二选一 📄：
- `/goal draft <一句话>` → 用 `goal_judge` 辅助模型展开成完整 contract（借鉴 Codex "let the agent draft the goal" 建议）；
- `/goal <headline>` + `verify:`/`constraints:`/`scope:`/`stop when:` 等字段前缀内联写。

带 contract 时，**judge prompt 改用 `JUDGE_USER_PROMPT_WITH_CONTRACT_TEMPLATE`**：严格按 verification 判 done，constraints 被违反则 NOT done。这直接收紧 `/goal` 最常见的失败模式（过早完成 或 对模糊目标无限续）。

### 5.2 `/subgoal`（中途追加验收）

`/subgoal <text>` 往 active goal 追加编号验收项，**不重置 loop** 📄📦。judge prompt 改用 `JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE`，verdict 必须考虑每个 subgoal——原始 goal **和** 每个 subgoal 都满足才算 done。

### 5.3 Quality gates（确定性门，judge 之前）

`GoalGate` = 一个必须 exit 0 的 shell 命令 📦。每轮在 judge **之前**跑：

- **gate 失败 → 短路 judge**：gate 输出（尾部 ~3KB）直接成 continuation prompt，agent 对着真实失败迭代，而非凭感觉。
- **workspace 未变 → 不重跑** 📦（`workspace_fingerprint` = git HEAD + 工作区状态的指纹）：gate 失败后若 workspace 没变，重放上次失败、推进 attempt 计数——防卡死 agent 反复跑同一个红 suite 烧预算。
- **retries 有界** 📦：每 gate 默认 `max_retries=3`、`timeout=300s`，耗尽则 goal auto-pause（同 turn budget）。
- 灵感注明 📄：来自 Prime-Agent 的 bounded autonomous mode（`--autonomous-gate`）。

> gates + contracts 组合：contract 塑造「agent 瞄准什么」，gates 让「done」可机械检查。两者同设时 gates 先跑。

### 5.4 `/goal wait`（手动停车）

`/goal wait <pid> [reason]` 📄：把 loop 停在后台进程上，进程在跑时不每轮戳 agent，进程退出自动恢复。还有 `wait_on_session`（监听 watch_patterns 触发，适合永不退出的长 watcher）和 `wait_for_seconds`（rate-limit 退避）。

这是 judge 的 `wait` verdict 的**手动版**——用户也能主动 park loop。

---

## 6. 命令面 📄【文档】

| 命令 | 作用 |
|---|---|
| `/goal <text>` | 设/替换 goal，立刻开第一轮 |
| `/goal draft <text>` | 用辅助模型起草 contract 再设 |
| `/goal show` | 打印当前 contract |
| `/goal` / `/goal status` | 查状态 + 已用 turn |
| `/goal pause` / `resume` | 暂停/恢复（resume 重置 turn 计数） |
| `/goal clear` | 清除 |
| `/goal wait <pid>` / `unwait` | 停在后台进程 / 立即恢复 |
| `/goal gate add <cmd>` / `gate` / `gate remove <N>` / `gate clear` | 质量门管理 |
| `/subgoal <text>` / `remove <N>` / `clear` | 子目标管理 |

**跨平台一致** 📄：CLI 和所有 gateway（Telegram/Discord/Slack/Matrix/Signal/WhatsApp/SMS/iMessage/Webhook/API/Web dashboard）行为相同。

---

## 7. 持久化与 runtime 解耦 📦【源码】

- **持久化** 📦：goal + contract + subgoals + gates 存 `SessionDB.state_meta`（key by session id），跨 `/resume` 和 context compression 存活。`load_goal`/`save_goal` 读写。
- **judge 独立于 runtime** 📄：Hermes 可选 codex app-server runtime（把 turn 交给 Codex 跑）。文档明确 📄：*"The goal judge runs via the auxiliary client, independent of which runtime is active."* 即不管 turn 在 Hermes 自家 runtime 还是 codex app-server 跑，judge 都走 auxiliary.goal_judge。continuation prompt 作为普通 user message 喂回 `run_conversation()`，codex 原生执行下一 turn。

---

## 8. 在 Ralph loop 家族里的定位

| 维度 | Hermes |
|---|---|
| 完成判定 | **独立 judge 模型**（auxiliary.goal_judge，三 verdict） |
| 续 turn 引擎 | ✅ turn gate（evaluate_after_turn → caller 续） |
| 预算 | **max_turns=20**（turn budget，非 token） |
| 防死循环 | max_turns + judge 连续失败 auto-pause + gate retries |
| 持久 | ✅ SessionDB.state_meta（跨 resume + 压缩） |
| 独有护栏 | completion contracts + /subgoal + quality gates + /goal wait |
| 形态 | Python（`hermes_cli/goals.py`）+ 全 gateway 一致 |

> Hermes 是家族里**工程最成熟**的：它同时吸收了 Codex（loop）和 Claude Code（独立裁判）的长处，又用 contract/subgoal/gate 把「done 到底怎么判」从「靠 LLM 感觉」推进到「结构化 + 可机械验证」。代价是复杂度——2156 行 Python + 四套叠加的判定层。
