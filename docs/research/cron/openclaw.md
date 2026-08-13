# OpenClaw 的 Cron / Automations 机制调研

> **调研方式**：读 `openclaw/openclaw` 仓库源码 + 文档（`docs/automation/`）
> **仓库版本**：`2a8b322e`（2026-08-13）｜**调研日期**：2026-08-13
> **姐妹文档**：`cron/claude-code.md`、`cron/hermes.md`、`cron/comparison.md`

## 来源标记

| 标记 | 含义 |
|---|---|
| 📦【源码】 | 读仓库源码（`src/`）确认 |
| 📄【文档】 | 读 `docs/` 确认 |

---

## 0. TL;DR

- OpenClaw 有**两套相关机制**，底层统一到 **Automations scheduler** 📦📄：
  - **Automations**（=`cron` 的正式名）：headless 独立调度服务（≈ Hermes cron），是主力。
  - **Heartbeat**：在**主会话**定期跑 agent turn 让模型主动「surface anything that needs attention」（≈ Claude Code 的 cron 语义），底层由 automations scheduler 驱动。
- **OpenClaw 最独特的贡献：事件驱动调度** 📄——除了 `at`/`every`/`cron` 三种时间驱动，还有 **`on-exit`**（进程退出触发）和 **`stream`**（长命令 stdout 流式 batch 触发）两种**事件触发**类型，以及 **condition watchers**（headless script 返回 `{fire, state}` 的条件门）。
- **`/loop` chat shortcut** 📄：owner-only，绑定会话——直接对标 Claude Code 的 `/loop`。
- **dynamic cadence（pacing）** 📄：recurring job 运行时可调 `automations next_check` 自定下次检查时间（min/max bounds）——对标 Claude Code 的 `ScheduleWakeup` 自步。
- **3 种 payload** 📄：system-event（入队主会话，无 model 调用）/ agent-message（model turn）/ command（shell，无 model）——agent 参与完全可选。
- 存**共享 SQLite state DB** 📦（不是 JSON）。

---

## 1. 双机制：Heartbeat + Automations 📦📄

OpenClaw 把「定时唤醒主 agent」和「独立调度后台任务」分成两个概念，但**底层都是 automations scheduler** 📄：

```
Automations scheduler（Gateway 进程内，SQLite 持久化）
  │
  ├── 普通 automation job（用户创建）
  │     at / every / cron / on-exit / stream
  │     payload: system-event / agent-message / command
  │     session: isolated / main
  │
  └── system-owned heartbeat job（gateway 每 agent 维护一个）
        可见于 openclaw cron list --all："Heartbeat (agent-id)"
        = 在主会话定期跑 agent turn（heartbeat prompt）
```

### Heartbeat（≈ Claude Code cron）

heartbeat 文档 📄：*"runs periodic agent turns in the main session so the model can surface anything that needs attention without spamming you."*

- **在主会话跑**（不是 isolated）——这是它与普通 automations 的核心区别，也是它与 Claude Code cron 的相似处（都注入交互会话）。
- 默认 30m（Anthropic OAuth/token auth 时 1h）。
- **无事可报 → `HEARTBEAT_OK`**（静默，strip 并 drop；start/end 出现才算，中间出现不特殊处理）。
- **busy 时推迟** 📄：主队列/automation 活跃、同 agent 有 reply/embedded run、target session 有活跃/排队工作 → heartbeat 推迟到下一 tick。**这和 Claude Code「仅 REPL 空闲触发」一脉相承**。
- **active hours** 📄：可限定活跃时段（本地时区），窗外跳过。

### Automations（≈ Hermes cron）

普通 automation job 在 **isolated session** 或 main session 跑，是 headless 调度——详见 §3-5。

> **设计洞察**：OpenClaw 用「heartbeat vs automations」把 Claude Code 和 Hermes 的两种 cron 哲学**显式命名并共存**：heartbeat = 对话内定时唤醒（Claude Code 式），automations = 独立后台调度（Hermes 式）。底层统一调度器避免重复实现。

---

## 2. Automations 调度类型 📄【文档】—— 5 种（含 2 种事件驱动）

| 类型 | CLI flag | 驱动 | 说明 |
|---|---|---|---|
| `at` | `--at` | 时间（one-shot） | ISO 8601 或相对（`20m`） |
| `every` | `--every` | 时间（间隔） | `10m` / `1h` / `1d` |
| `cron` | `--cron` | 时间（表达式） | 5 或 6 字段，可选 `--tz`（IANA） |
| **`on-exit`** | `--on-exit` | **事件**（进程退出） | watched command 退出即触发；survives turn teardown |
| **`stream`** | `--stream-command` | **事件**（命令 stdout 流） | 长命令 stdout/stderr 行 batch 触发 |

**`on-exit` 和 `stream` 是 OpenClaw 独有**——把 cron 从「纯时间驱动」推进到「事件驱动」。`stream` 可配 `--stream-mode match` + regex 只接受匹配行，`--stream-batch-ms`（静默窗口，默认 250ms）和 `maxBatchBytes`（默认 16384）控制 batch 大小。

> 对比：Hermes 用 `wakeAgent` pre-run gate 做事件驱动（脚本判状态变才唤醒 agent）；OpenClaw 直接把事件源做成**一等调度类型**（on-exit / stream）。两种思路：Hermes 是「时间触发 + 脚本门控」，OpenClaw 是「事件本身就是触发源」。

---

## 3. Condition watchers（事件触发器） 📄【文档】

任何 `every`/`cron`/`stream` 调度可附 **trigger script**（headless condition watcher）📄：

```js
trigger.script: "const res = await tools.call('exec', {...});
                 json({ fire: status !== trigger.state?.status,
                        message: `CI: ${state} -> ${status}`,
                        state: { status } })"
```

- 脚本返回 `{ fire, message?, state? }`；`trigger.state` 是上次持久化的 JSON（≤16KB）。
- `fire:false` → 持久化 state + 计数器，reschedule，**不创建 run history**。
- `fire:true` → 跑 payload，`message` append 到 payload。
- **失败 payload 的 state 不持久化** → 下次评估用旧 state，可再次 fire（脚本写成只读检查，动作放 payload）。
- **最低间隔 30s**，每次评估 30s wall-clock 预算 + 最多 5 tool calls。
- **安全** 📄：`cron.triggers.enabled` flag 开启才允许——这等同「unattended code execution with agent's full tool policy including `exec`」，文档明确警告 *"leave it disabled unless every agent allowed to create automation jobs is trusted"*。

> 这是 OpenClaw 把 Hermes 的 `wakeAgent` gate **泛化成通用 condition watcher**——不限于「唤醒/不唤醒 agent」，而是「fire/不 fire 整个 payload」+ 持久化状态做去重。

---

## 4. Payload 类型 📄—— agent 参与三档

| Payload | flag | 是否调 model |
|---|---|---|
| **system-event** | `--system-event <text>` | ❌（入队主会话，本身不调 model） |
| **agent-message** | `--message <text>` | ✅（model-backed agent turn） |
| **command** | `--command <shell>` / `--command-argv <json>` | ❌（Gateway host 上跑 shell） |

> 三档 payload 让 OpenClaw 的 cron 从「纯 shell 任务」到「纯 model 任务」连续可选——对标 Hermes 的 no-agent / wakeAgent gate，但 OpenClaw 用**独立的 payload kind** 而非「agent 前加脚本门」。

---

## 5. 其他调度特性 📄

- **dynamic cadence（pacing）** 📄：recurring job 设 `pacing.min`/`pacing.max`，运行时 agent 可调 `automations next_check` 提议下次检查时间（从成功完成起算，clamp 到 bounds）。失败/超时/跳过的 run 丢弃提议，走正常 retry/error-backoff。**对标 Claude Code 的 `ScheduleWakeup` 自步**，但有上下界 clamp。
- **`/loop` chat shortcut** 📄：owner-only，`/loop [interval] <prompt>` 建 recurring agent-turn job 绑定该会话；`/loop status` / `/loop stop [name]`。给 interval 走固定 cadence，不给则 `next_check` 自步（1min–1h）。**直接对标 Claude Code 的 `/loop`**。
- **timezone** 📄：`--tz America/New_York`（IANA）；无 `--tz` 的 cron 用 Gateway 主机时区。
- **stagger** 📄：top-of-hour 表达式（minute=0 + hour wildcard）自动 ±5min 错峰减负载；`--exact` 强制精确，`--stagger 30s` 显式窗口。
- **day-of-month/week OR 逻辑** 📄：用 croner 解析，两字段都非 wildcard 时**任一匹配即触发**（标准 Vixie cron 行为）——要 AND 用 `+` 修饰符。
- **heartbeat migration** 📄：旧 heartbeat 的 `tasks:` 结构化块由 `openclaw doctor --fix` 转成普通 automation job（保留 interval + last-run timing）。

---

## 6. 执行与会话模型 📄【文档】

- **isolated session** 📄：job 在隔离 session 跑（默认）——fresh context，无主会话历史。有 hardened cleanup（best-effort 关浏览器 tab/process、销毁 bundled MCP runtime）。
- **main session** 📄：system-event payload 入队主会话；heartbeat 在主会话跑 agent turn。
- **overdue isolated job** 📄：Gateway 启动时 **reschedule**（不立即 replay）——把 model/tool bootstrap 工作挡在 channel-connect 窗口外。
- **timeout** 📄：`--timeout-seconds` 或默认（isolated agent-turn 受 scheduler 60min watchdog 约束；command 默认 10min；script 默认 5min）。
- **task reconciliation** 📄：runtime-owned first，durable-history-backed second——active automation task 在 runtime 仍 track 时保持 live；runtime 停 owning + 5min grace 后查持久化 run log。

---

## 7. 存储 📦📄

存**共享 SQLite state DB** 📄（job 定义 + runtime state + run history）——比 Hermes 的 JSON 更结构化，重启不丢调度。每 run 创建 background task 记录 📄。

one-shot job（`--at`）默认成功后 auto-delete（`--keep-after-run` 保留）📄。

---

## 8. 在 cron 家族里的定位

| 维度 | OpenClaw automations + heartbeat |
|---|---|
| 架构 | **Gateway 进程内 scheduler**（双机制：heartbeat=主会话唤醒 / automations=独立调度） |
| 触发前提 | Gateway 在跑 |
| 调度类型 | **5 种**（at/every/cron/on-exit/stream）——含 2 种事件驱动 |
| condition watcher | ✅（trigger script `{fire,state}`，持久化去重） |
| 漏触发 | overdue isolated job 启动时 reschedule（不 replay） |
| 存储 | 共享 SQLite state DB |
| payload | 3 档（system-event / agent-message / command） |
| 自步 | pacing（next_check，min/max bounds） |
| `/loop` | ✅ chat shortcut（对标 Claude Code） |
| 安全 | `cron.triggers.enabled` flag（unattended exec） |

> OpenClaw 是家族里**调度类型最丰富**的：时间驱动（at/every/cron）+ 事件驱动（on-exit/stream）+ 条件门（watcher）+ 自步（pacing）+ 会话内唤醒（heartbeat）。它把「定时」泛化成「自动化触发」，cron 只是其中一种 trigger。它的 heartbeat 还直接呼应 Claude Code 的「交互会话内定时注入」语义——证明这两种哲学（会话内 vs 独立调度）是真实的设计空间，OpenClaw 选择**两者都做**。
