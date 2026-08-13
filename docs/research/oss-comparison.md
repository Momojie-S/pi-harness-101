# 开源同类产品实现对比：cron 与 goal 机制

> **目的**：把 Claude Code 的两套"继续/循环"机制（`/loop` cron 时间驱动、`/goal` 完成驱动）放进开源生态对照，看哪些是惯例、哪些是独创。
> **方式**：3 个并行研究 agent 调研高 star 开源项目（web + repo/docs）。
> **日期**：2026-08-12｜**姐妹文档**：`cron/claude-code.md`、`goal/claude-code.md`
>
> ⚠️ **〔2026-08-13 修正〕本文「Goal」一节的结论已过时。** 本轮调研对象（AutoGPT/BabyAGI/LangGraph/CrewAI/MetaGPT/OpenHands）是**通用 agent 框架**，确实都是「agent 自报 done + 固定迭代上限」范式、无完成驱动 goal 循环——这部分观察有效。但**对照组选错了**：与 Claude Code `/goal` 真正同类的是 **Codex / Hermes / OpenClaw** 的 `/goal`（同属「Ralph loop 家族」，Codex 是源头），本轮未覆盖。完整谱系与四家逐维对照见 **`goal/comparison.md`**（含对本节「goal 基本独一份」结论的纠正）。本文 Cron 一节仍有效。

---

## 一、Goal / 完成驱动循环

**Claude Code `/goal` 回顾**：用户给自然语言停止条件 → 建 Stop hook → 每次想停止时由**独立的 Haiku 级裁判模型**读 transcript 判定 `{ok,reason,impossible?}` → 未达成则强制继续；上限 max_turns=200 或连续阻止>8；跨 resume 持久化；默认保守（缺证据=未完成）。

| 项目 | ~star | 循环驱动 | 终止判定 | 独立裁判？ | 防死循环 | resume |
|---|---|---|---|---|---|---|
| **AutoGPT** | 170k | while+command | agent 自发 `finish` 命令 | ❌ | max_steps/budget/手动 | 经典版无 |
| **BabyAGI** | 20k(归档) | `while True` 生成新任务 | **无内生终止**（永远生成新任务） | ❌ | 无（外部加计数器） | 无 |
| **LangGraph** | 14k(LangChain 123k) | graph superstep + 条件回边 | agent 自路由到 `END` 或 `recursion_limit`(默认25) | ❌ | recursion_limit | ✅ Checkpointer(SQLite/Postgres) |
| **CrewAI** | 28k | ReAct 工具循环 | agent 自报 "Final Answer" 或 `max_iter`(~25) | ❌ | max_iter/max_time | 弱 |
| **MetaGPT** | 62k | n_round 递减 + 多agent消息总线 | `n_round`尽(默认3)/`env.is_idle`/预算 | ❌(idle 启发式) | round+预算 | 部分 |
| **OpenHands** | 52k | controller `_step` | agent 发 `finished`/`submit` 或 `max_iterations`(常500) | ❌（但有**规则型** Stuck Detector 杀循环） | max_iter + 规则型卡死检测 | ✅ session replay |
| **Claude Code** | — | Stop hook 阻止停止 | **独立 Haiku 裁判读 transcript** | ✅ **唯一** | max_turns=200 + 连续阻止>8 | ✅ restored_on_resume |

**合成**：
- **主流模式（6/6）**：agent **自报"done"**（finish/Final Answer/END/finished）+ 固定迭代/预算上限兜底。**没有任何框架靠"每轮重新核对 goal"来驱动继续**。
- **独立裁判模型：0/6**。最接近的是 OpenHands Stuck Detector，但它是**规则型**（同动作≥4次等），只杀循环、不判"goal 真达成"。
- **信任偏向**：6/6 都信 agent 的"done"。Claude Code 的**"缺证据=未完成"保守默认是反惯例的**——多数框架偏向早停。
- **结论**：Claude Code 的"**独立廉价裁判 + 结构化裁决 + 保守默认 + 跨 resume**"组合在主流 OSS 里**几乎找不到同类**，是相当独特的设计。

> ⚠️ **〔2026-08-13 修正〕**：此结论在本轮调研范围内成立，但**对照组应为 Codex/Hermes/OpenClaw**（Ralph loop 家族），非本表所列通用框架。Hermes 的 `/goal` 正是「独立裁判 + 结构化裁决 + 保守默认 + 跨 resume」组合，且明确 credit Codex。详见 `goal/comparison.md` §0 的纠正。

---

## 二、Cron / 定时调度（agent 工具层）

> ✅ **〔2026-08-13 深化〕本节结论仍然有效，已用三家源码调研补全定位**：Hermes（gateway daemon）、OpenClaw（automations + heartbeat 双机制）的 cron 源码调研 + Codex/OpenCode「无 agent 层 cron」确认见 **`cron/comparison.md`**。本节的「A 会话内 / B 独立调度」哲学分野在该文档 §0 正式确立，§4 用三家深度调研逐条补全了本表的定位。

**Claude Code cron 回顾**：5 字段 cron 表达式；仅在 REPL 空闲时触发；recurring 7 天自动过期；忙时错过=**静默跳过**（不排队）；可选 JSON durable / session-only；payload 过安全分类器。

| 项目 | ~star | 内置调度？ | 表达式 | 存储/持久 | 漏触发/重叠 |
|---|---|---|---|---|---|
| **Goose** | 52.7k | ✅ CLI `goose schedule` | cron(时区感知) | **本地 JSON** `~/.local/share/goose/schedule.json` | 漏触发丢弃；**允许并发** |
| **Cline** | 66k | ✅(仅 SDK/CLI/Kanban，非插件) | cron | 本地 hub 守护进程 | 可配 queue/skip；并发限制 |
| **LangGraph Platform** | 39.5k | ✅(仅平台层，需 Postgres) | cron+TZ | Postgres | `multitask_strategy`: reject/interrupt/rollback/enqueue |
| **AutoGPT Platform** | 185k | ✅(平台层) | UI 选择器→APScheduler cron | Postgres+Redis | `replace_existing=True` |
| **OpenHands automation** | 83.8k(主仓) | ✅(独立 beta 服务) | cron(NL→cron) | Postgres | 未文档化 |
| **Aider** | 48k | ❌ | — | — | 外部 OS cron 包 `--message` |
| **Continue** | 35.5k | ❌ | — | — | GitHub Actions `on:schedule` |
| **Roo-Code** | 24.4k(归档) | ❌(仅社区插件) | — | — | — |
| **AgentGPT** | 36k(归档) | ❌ | — | — | — |
| **Claude Code** | — | ✅(`/loop` 交互内) | cron | JSON/session | **忙时跳过**；单线程不重叠 |

**合成**：
- **平台/服务层调度很常见**（LangGraph/AutoGPT/OpenHands），**交互式 CLI/IDE 编码 agent 里很罕见**——只有 **Goose** 和 **Cline** 内置。Aider/Continue/Roo/AgentGPT 都没有。
- **没有的同行靠外部化**：OS cron 包 headless CLI（Aider 标准做法）、GitHub Actions、或 server orchestrator。
- **最像 Claude Code 的同行是 Goose**：本地 JSON + cron + 进程内调度 + 同一套权限系统。footprint 几乎一致。
- **Claude Code 的不寻常处**：① **绑定 REPL 空闲**才触发（同行都是 daemon/server，进程在就触发）；② **强制 7 天过期**（LangGraph `end_time` 是可选）；③ **payload 安全分类器**（同行用权限继承/feature flag，不做内容分类）；④ 在**交互循环里用 slash 命令**创建。
- **哲学分野**：Goose 进程在就触发且**允许并发**；Claude Code **只在 REPL 空闲触发且忙时跳过**——因为 Claude Code 是在交互会话内调度，不是 headless daemon。

---

## 三、Cron 原语（vs 生产级调度器）

| 引擎 | ~star | 表达式 | 持久化 | **漏触发处理**（关键对比） | 重试/语义 |
|---|---|---|---|---|---|
| **Temporal** | 12k | Schedule spec(也吃 cron) | 服务端 DB | **CatchupWindow 缓冲补跑**(默认1年) | at-least-once + RetryPolicy |
| **Celery beat** | 28k | 5字段cron | 内存/DB | 重启后 **批量补发所有漏跑** | at-least-once(broker) |
| **BullMQ** | 6-7k | cron/every | Redis | worker 在线即推进，不堆积 | 延迟 job 持久 |
| **APScheduler** | 6k | cron/interval | Memory/SQLA/Mongo | **misfire_grace_time + coalesce + max_instances** 三件套 | 可配 |
| **Agenda** | 9.7k | cron/interval | MongoDB | nextRunAt 持久，重连即补 | 锁+并发 |
| **node-cron/croner** | 3-4k | 5/6字段 | **无**(进程内) | 进程宕了就丢 | 无 |
| **K8s CronJob** | 110k | 5字段 | etcd | `startingDeadlineSeconds`；**≥100 次漏触发自动挂起** | concurrencyPolicy |
| **Claude Code** | — | 5字段 | JSON(可选) | **静默跳过，不排队/不补/不告警** | at-most-once，无重试 |

**合成（设计哲学鸿沟）**：
1. **漏触发是最锋利的分水岭**：生产调度器要么**排队/补跑**（Temporal/Celery/BullMQ）、要么**合并**（APScheduler/Temporal BufferOne）、要么**报错/挂起**（K8s）。Claude Code 的**静默跳过**在任何一个里都会被视为"数据丢失 bug"。
2. **"空闲才触发"闻所未闻**：7 个调度器无一绑交互运行时状态，都按墙钟无条件跑。Claude Code 把调度当"用户回合之间检查的提示"，不是 deadline。
3. **持久化**通常是真 DB/Redis/etcd；Claude Code 的 JSON 是进程内 best-effort，更像 APScheduler 的 MemoryDataStore。
4. **at-least-once + 重试 + 死信**是 Temporal/Celery/BullMQ 的标配；Claude Code **无重试、无死信、at-most-once**（跳过的触发永久丢失），唯一安全网是 payload 分类器。
5. **7 天自动过期反惯例**——生产调度器预期无限期运行；过期是 Claude Code 的会话级护栏，不是调度器特性。
6. **结论**：Claude Code 的 cron 是**轻量、进程内、best-effort、idle 门控的单会话轮询器**，精神上接近 node-cron 而非 Temporal。在 Celery/Temporal 里"忙时跳过"会是 sev-1 事故；在 Claude Code 里是预期行为——因为它根本不承诺可靠投递。

---

## 四、总合成：Claude Code 两套机制在生态里的定位

1. **`/goal` 的"独立裁判 + 保守默认"在主流 OSS 里基本独一份**。6 个高 star 框架全靠 agent 自报完成 + 固定迭代上限；没有一个用廉价裁判模型反复核对用户停止条件。这是 Claude Code 最有辨识度的设计。
2. **`/loop` cron 的"交互会话内调度"很罕见**。交互编码 agent 里只有 Goose、Cline 内置；Goose 是最接近的同款（本地 JSON + cron + 进程内）。多数同行靠 OS cron/CI 外部化。
3. **Claude Code 的 cron 不是、也不装作是可靠调度器**。和生产级（Temporal/Celery/BullMQ）相比，它刻意用"跳过+7天过期+at-most-once"换轻量——因为它服务的是单个交互会话的"定期提醒/轮询"，不是必须投递的任务队列。
4. **共性**：cron 表达式格式（5 字段）是全行业共识；JSON 本地文件持久化（Goose/Claude Code）是轻量 agent 工具的常见选择；权限继承而非内容审核是同行的主流安全模式（Claude Code 额外加了分类器）。

> **一句话**：goal 独创、cron 轻量且交互化、两者都明确服务于"单交互会话"语义——这是 Claude Code 与 Temporal 级可靠性、AutoGPT 级自治循环之间的精确占位。
