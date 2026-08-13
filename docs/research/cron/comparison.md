# Cron / 定时调度：跨产品综合对比

> **目的**：把 Claude Code、Hermes、OpenClaw 三家的 cron/调度机制对照，厘清「会话内定时注入」与「独立调度服务」两种哲学，并整合 `oss-comparison.md` 早期对 Goose/Cline/LangGraph 等的结论。
> **方式**：读三家源码（见各姐妹文档）+ 早期 web/docs 调研。
> **日期**：2026-08-13
> **姐妹文档**：`cron/claude-code.md`、`cron/hermes.md`、`cron/openclaw.md`

---

## 0. 两种 cron 哲学（最重要的分野）

cron 调研最锋利的分水岭不是「有没有 cron」，而是 **「在交互会话内触发」还是「在独立调度进程里触发」**：

| 哲学 | 代表 | 触发前提 | 漏触发 | 定位 |
|---|---|---|---|---|
| **A. 会话内定时注入** | Claude Code（`/loop`）、OpenClaw（heartbeat） | 交互会话**空闲** | 忙时跳过，不补发 | 「用户回合之间的提醒」 |
| **B. 独立调度服务** | Hermes（gateway cron）、OpenClaw（automations）、Goose、LangGraph、AutoGPT | **调度进程在跑** | daemon 恢复后等下一个（不补跑） | 「无人值守的自治调度」 |

- **Claude Code 纯 A**：cron 是 session-scoped，注入同 session（`queuePriority=later`），仅 REPL 空闲触发。它服务的语义是「在对话里定时戳一下」，不是可靠投递的任务队列。
- **Hermes 纯 B**：cron 是 gateway daemon，在 fresh isolated session 跑，多平台 delivery。它服务的语义是「定时自动跑任务并交付」，是真正的调度器。
- **OpenClaw 两者都做**：heartbeat（A，主会话唤醒）+ automations（B，独立调度），底层统一调度器。这是最完整的——它显式承认两种语义各有适用场景。

> **`oss-comparison.md` 早期洞察在此得到验证**：「平台/服务层调度很常见（LangGraph/AutoGPT/OpenHands），交互式编码 agent 里很罕见（只有 Goose/Cline）」。现在补全：Hermes/OpenClaw 属于 **B（daemon 形态）**，Claude Code 属于 **A（交互会话内）**——Claude Code 的"绑定 REPL 空闲"在 OpenClaw 的 heartbeat 里找到了回声。

---

## 1. Codex / OpenCode：确认无 agent 层 cron

为 completeness，确认这两个产品**没有** agent 层的 cron/定时调度：

- **Codex CLI**：grep `cron`/`scheduled_task` 在 `codex-rs/core`、`codex-rs/protocol` 无实现命中。`codex-rs/cloud-tasks/` 是**云端任务系统**（`codex_cloud_tasks_client`，OpenAI 云端托管的 PR/issue 处理任务），不是 agent 层定时调度。⇒ Codex 的"定时/异步"靠云端 cloud-tasks，不在本地 agent。
- **OpenCode**：`packages/cli/src/services/daemon.ts` 是**后台 server 管理守护进程**（注册/发现 opencode server 进程），不是 cron 调度。全仓无 cron/loop/定时注入实现。⇒ OpenCode 没有 cron。

⇒ **agent 层 cron 是 Claude Code / Hermes / OpenClaw 三家的特征**；Codex/OpenCode 这两个"纯编码 agent"不做本地调度（要定时就靠外部 OS cron / 云端）。

---

## 2. 三家逐维对照表

| 维度 | Claude Code | Hermes | OpenClaw |
|---|---|---|---|
| **架构哲学** | A（会话内注入） | B（独立调度服务） | A+B（heartbeat + automations） |
| **触发前提** | **REPL 空闲** | daemon 在跑 | Gateway 在跑 |
| **入口** | `/loop` → `CronCreate` 工具 | `/cron` / `cronjob` 工具 / CLI / 自然语言 | `/loop` chat shortcut / `automations` 工具 / CLI |
| **调度格式** | 5 字段 cron | 4 种（相对/间隔/cron/ISO） | **5 种**（at/every/cron/**on-exit**/**stream**） |
| **事件驱动** | ❌（纯时间） | `wakeAgent` pre-run gate（时间触发+脚本门控） | **on-exit / stream / condition watcher**（事件即触发源） |
| **自步** | `ScheduleWakeup`（flag OFF） | ❌ | **pacing**（`next_check`，min/max bounds） |
| **漏触发** | 忙时跳过，不补发不排队 | daemon 恢复等下一个 + 健康监测 | overdue isolated job 启动 reschedule |
| **并发** | 单线程不重叠 | file lock + job 级 dedup | runtime-owned + durable-history-backed reconciliation |
| **agent 参与** | 总是 agent turn | 可选（no-agent / wakeAgent gate） | 三档 payload（system-event/agent-message/command） |
| **交付** | 注入同 session（`queuePriority=later`） | 20+ 平台 + origin/local/all | chat channel / webhook / none |
| **存储** | JSON（session-only/durable） | `jobs.json`（atomic）+ `executions.db` | 共享 SQLite state DB |
| **持久** | 跨 resume（durable 可选） | 跨 gateway 重启（jobs 持久） | 跨重启（SQLite） |
| **过期** | recurring 7 天自动过期 | 无（forever until removed） | one-shot 默认成功后 auto-delete |
| **安全** | fire 时 **auto-mode 分类器**（Instruction Poisoning） | create/update 时 **prompt-injection 扫描** + 递归防护 | **`cron.triggers.enabled` flag**（unattended exec 开关） |
| **独有** | ScheduleWakeup 双唤醒源（定时+task-notification） | Chronos 托管（scale-to-zero）、job 链（context_from）、preflight、model drift guard、skill 附着 | on-exit/stream 事件调度、condition watcher、heartbeat、pacing、stagger |
| **形态** | session-scoped hook（交互会话内） | Python gateway daemon | TS Gateway scheduler |

---

## 3. 关键洞察

### 3.1 「会话内」vs「独立调度」决定了一切下游语义

Claude Code 因为是会话内注入，所以：
- **必须绑 REPL 空闲**（不能 mid-query 打断）→ 忙时跳过 → 有效频率 = max(间隔, 任务耗时)。
- **结果留在对话里**（注入同 session）→ 没有"交付到别处"的概念。
- **payload 分类器在 fire 时跑**（因为注入的是 live 对话，Instruction Poisoning 风险高）。

Hermes/OpenClaw 因为是独立调度，所以：
- **不关心交互会话忙不忙**（daemon 自己 tick）→ 错过只影响「daemon 是否在跑」。
- **结果 delivery 到配置目标**（多平台）→ 交付是一等公民。
- **安全检查在 create/update 时**（job 是预定义的，不是 live 注入）+ 递归防护（cron session 不能建 cron）。

⇒ 选 A 还是 B 不是风格偏好，是**对"cron 到底服务什么语义"的根本回答**：A 服务「对话中的定时提醒」，B 服务「无人值守的自治任务」。选错会导致语义错配（用 A 做"每天 9 点发报告"会因为 REPL 不在线而漏；用 B 做"每 5 分钟戳一下当前对话"会丢失会话上下文）。

### 3.2 事件驱动是调度类型的质变

纯时间驱动（at/every/cron）只能回答「什么时候做」。OpenClaw 的 `on-exit`/`stream`/condition-watcher 回答「**状态变成什么时做**」——这是从 cron 到**事件触发系统**的跃迁：

- **Hermes** 用「时间触发 + wakeAgent 脚本门控」近似事件驱动（时间到 → 脚本判状态变才唤醒 agent）。
- **OpenClaw** 把事件做成一等调度类型（on-exit/stream 直接由事件触发；condition watcher 在 every/cron 上叠加条件门）。

> OpenClaw 更彻底：它把 `cron-jobs.md` 命名为 **"Automations"**（`cron` 只是 alias）——因为它的调度早已超越 cron 表达式，是通用的「自动化触发」系统。Hermes 仍叫 cron 但加 wakeAgent gate 往事件方向靠。

### 3.3 agent 参与的「可控档位」是新维度

Claude Code 每次 cron 都是一次 agent turn（无选择）。Hermes/OpenClaw 让 agent 参与**可选**：

| 档位 | Claude Code | Hermes | OpenClaw |
|---|---|---|---|
| 纯 shell（零 LLM） | ❌ | ✅ `no_agent` | ✅ `command` payload |
| 脚本门控的 agent | ❌ | ✅ `wakeAgent` gate（$0 轮询） | ✅ condition watcher（fire/false） |
| 总是 agent turn | ✅（唯一档） | ✅（默认） | ✅ `agent-message` payload |

这直接解决「频繁轮询不该每个 tick 烧 token」——是 daemon 形态（B）才有的优化空间（A 形态的注入本来就是 agent turn，没有"要不要调 model"的选择）。

### 3.4 漏触发的三种语义

| | 语义 | 谁这么做 |
|---|---|---|
| **忙时跳过** | 当前会话忙 → 丢这次，等下一个 | Claude Code（REPL 忙）、OpenClaw heartbeat（busy 推迟） |
| **daemon 恢复等下一个** | 调度器挂了 → 恢复后等 next_run_at，不补跑过去 | Hermes、OpenClaw automations（overdue reschedule） |
| **补跑/排队** | 错过的补发或入队 | **三家都不做**（都 at-most-once，无重试无死信） |

⇒ 三家在「不补跑」上**共识**——和 `oss-comparison.md` 指出的「生产调度器（Temporal/Celery）都会补跑/排队，Claude Code 的跳过在那里是 data-loss bug」一致。Hermes/OpenClaw 作为 daemon 也选择不补跑：它们是 best-effort 自动化，不承诺可靠投递（要可靠投递用 Temporal 级系统）。

### 3.5 安全模型的差异反映风险面

- **Claude Code fire 时分类器**：注入 live 对话 → Instruction Poisoning（让未来 session 外泄自身 prompt）风险高 → 每个 payload fire 前过 auto-mode 分类器，composite 连坐。
- **Hermes create/update 时扫描**：job 是预定义的、跑在 isolated session → 在创建/编辑时扫 prompt-injection/credential-exfiltration；fire 时不再检查（job 已通过审查）。
- **OpenClaw flag 开关**：condition watcher/trigger script 等同 unattended code execution（full tool policy + `exec`）→ 用 `cron.triggers.enabled` flag 显式开启，文档警告 *"leave it disabled unless every agent is trusted"*。

⇒ 风险面 = payload 何时定型 × 在哪执行：live 对话注入（Claude Code）风险最高要 fire 时查；预定义 job（Hermes）create 时查即可；任意脚本执行（OpenClaw watcher）要 flag 显式授权。

---

## 4. 整合 oss-comparison.md 早期结论

`oss-comparison.md` Cron 一节（Goose/Cline/LangGraph/AutoGPT/OpenHands/Aider/Continue/Roo/AgentGPT）的结论**仍然有效**，在此用三家的深度调研补全定位：

| 早期结论 | 深度调研后的补全 |
|---|---|
| 「交互编码 agent 里 cron 罕见（只有 Goose/Cline）」 | ✅ 成立。Claude Code 是交互会话内 cron（A），OpenClaw heartbeat 是 A 的同类回声。Hermes/OpenClaw automations 是 daemon（B），不算"交互编码 agent"。 |
| 「Goose 是最接近 Claude Code 的同行（本地 JSON + cron + 进程内）」 | ✅ 成立。但更精确：Goose 是 **B（daemon）**，Claude Code 是 **A（会话内）**——它们"接近"在"本地 JSON + 进程内调度"，但触发哲学不同（Goose 进程在就触发，Claude Code 要 REPL 空闲）。 |
| 「多数同行靠 OS cron/CI 外部化（Aider/Continue）」 | ✅ 成立。Codex/OpenCode 也属此类——纯编码 agent 不做本地调度。 |
| 「Claude Code 的不寻常处：①绑 REPL 空闲 ②7天过期 ③payload 分类器 ④slash 命令创建」 | ①是 A 哲学的必然（会话内就得等空闲）；②7天过期是会话级护栏（Hermes/OpenClaw 不过期，因为是 daemon 长期任务）；③反映 live 注入的高风险面；④是 A 的典型入口（OpenClaw 也有 `/loop` shortcut）。 |
| 「Claude Code 的 cron 不是可靠调度器，用跳过+7天过期+at-most-once 换轻量」 | ✅ 成立且更清晰：A 哲学本就不承诺可靠投递。Hermes/OpenClaw（B）虽是 daemon 但也选择 at-most-once（不补跑）——说明"best-effort 自动化"是 agent cron 的共同定位，区别只在触发前提。 |

> **一句话总结**：agent 层 cron 有 A（会话内，Claude Code/OpenClaw heartbeat）和 B（独立调度，Hermes/OpenClaw automations/Goose）两种哲学；纯编码 agent（Codex/OpenCode/Aider/Continue）不做本地调度靠外部化；OpenClaw 是唯一 A+B 共存的。事件驱动（OpenClaw on-exit/stream）和 agent 参与可选（Hermes no-agent / OpenClaw payload 三档）是超越纯时间 cron 的两个演进方向。

---

## 5. 给本仓（pi harness）的启示

若要在 pi 上实现 cron，家族给出清晰选型：

- **问"服务什么语义"**：要在对话里定时戳一下 → A（会话内注入，绑空闲）；要无人值守定时跑任务 → B（独立调度器 + delivery）。
- **A 最小实现**：Claude Code 式（session-scoped 定时器 + 注入同 session + 仅空闲触发 + 跳过不补）。pi 当前是交互会话形态，A 最贴合。
- **B 最小实现**：Hermes 式（daemon tick + fresh session + delivery + file lock 防重叠 + 健康监测）。
- **演进方向**：①事件驱动（OpenClaw on-exit/stream 或 Hermes wakeAgent gate）——让"状态变化"成为触发源；②agent 可选（no-agent 纯脚本 / wakeAgent $0 轮询）——别让频繁轮询烧 token。
- **安全**：live 注入（A）要 fire 时查 payload；预定义 job（B）create 时查 + 递归防护。

> 详见各姐妹文档。本仓若落地，建议先记 ADR（选「A 会话内 vs B 独立调度」「时间 vs 事件驱动」「agent 总参与 vs 可选」三个决策点），再实现。
