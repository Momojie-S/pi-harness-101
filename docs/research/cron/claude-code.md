# Claude Code 的 cron / `/loop` 机制调研

> **调研方式**：解包二进制（grep）+ 线上实时触发 + transcript 取证
> **运行版本**：`2.1.226`（离线 bundle `2.1.113` 仅作对照）
> **调研日期**：2026-08-12｜**环境**：Windows 11，原生 `claude.exe`，`pi-harness-101` 会话

## 来源标记说明（本文档每条结论都标了出处）

| 标记 | 含义 | 可信度 |
|---|---|---|
| 📦【解包】 | grep 运行版 `claude.exe`(2.1.226) 或离线 bundle `2.1.113` 得到的静态字符串/代码 | 中：能看代码，但混淆/加密/feature-flag 会失真 |
| 🧪【实测】 | 本会话真实触发 `/loop` 或 cron，从 transcript JSONL 取证 | 高：线上真身 |
| 📋【工具描述】 | `CronCreate`/`ScheduleWakeup`/`Skill` 等工具的官方描述文案 | 高：官方规格 |
| 💡【推断】 | 基于机制的推理，非直接证据 | 低：仅作解释 |

---

## 0. TL;DR

- `/loop` 本身**不做循环** 🧪：它只注入一条「调度指令」prompt，**教模型**去调 `CronCreate`。
- 真正的循环载体是 **cron 定时器** 🧪：存 `prompt` 原文，每次触发**逐字重放**为一条 user 消息。
- 触发有**安全闸门** 🧪：禁止"让未来 session 回读/外泄自身 prompt 内部"的定时任务（Instruction Poisoning）。
- **cron 只在 REPL 空闲时触发，不会在 mid-query 时打断** 📦🧪；错过的 recurring 边界**跳到下一个、不堆积、不催促** 🧪。
- 循环里**没有独立 goal 对象** 💡：`CronCreate.prompt` 本身就是 goal。

---

## 1. 版本勘误 📦【解包】

| 来源 | 版本 | 说明 |
|---|---|---|
| 离线 bundle `versions/2.1.113` | 2.1.113（4 月） | 代码含大量 feature-flag 分支 |
| 运行中 `claude.exe` | **2.1.226** | 这些分支线上几乎全关 |

> `claude --version` → 2.1.226；`ls versions/` → 2.1.113（旧）。**不能只信解包**。

---

## 2. `/loop` 命令

### 2.1 它注入的提示词 🧪【实测】（transcript 逐字确认）

`/loop` 经 Skill 的 `getPromptForCommand` 解析成一条 **user 角色**消息注入。2.1.226 线上模板全文 🧪：

```
# /loop — schedule a recurring prompt
Parse the input below into `[interval] <prompt…>` and schedule it with CronCreate.
## Parsing (in priority order)
1. 首 token 匹配 ^\d+[smhd]$ → interval，剩下是 prompt
2. 否则末尾 "every <N><unit>" → interval（仅当 every 后是时间；"check every PR" 不算）
3. 否则 interval 默认 10m，整句是 prompt
（prompt 为空 → 打 usage，不调度）
## Interval → cron
Nm(≤59)→*/N * * * *｜Nm(≥60)→0 */H * * * *｜Nh→0 */N * * * *｜Nd→0 0 */N * *｜Ns→ceil(N/60)m
不能整除单位时取最近干净间隔并告知用户。
## Action
1. 调 CronCreate(cron=<上表>, prompt=<解析后原文>, recurring=true)
2. 确认：内容+cron+频率+7天自动过期+CronDelete(jobID)可取消
3. 立即执行一次 prompt（不等首次触发）
## Input
<用户原始输入>
```

> 交叉验证 📦：离线 bundle 2.1.113 里有同名函数 `_o1/qo1/Ko1/er1`，结构一致但分支更多。

### 2.2 与旧版/解包版的差异（feature flag） 📦🧪

| 能力 | 2.1.113 解包（代码存在）📦 | 2.1.226 线上 🧪 |
|---|---|---|
| 无 interval → 默认 10m recurring | ❌（当时是 dynamic 自步） | ✅ |
| dynamic 自步（`ScheduleWakeup`） | ✅（`isLoopDynamicEnabled`） | ❌ 关闭 |
| `until <条件>` 终止型 | ✅（`isLoopDefaultPromptEnabled`） | ❌ 关闭 |
| `loop.md` 任务文件 | ✅（`readLoopFile`） | ❌ 关闭 |
| 长 interval/日常用语 → 兜售云调度 | ✅（`g_7`，调 `schedule` skill） | ❌ 关闭 |
| Instruction Poisoning 闸门 | — | ✅（实测命中） |

> **dynamic 自步的开启条件** 📦【解包】：`isLoopDynamicEnabled` 在 2.1.226 已被混淆（grep 0 命中），但 flag key **`tengu_kairos_loop_dynamic`** 仍在 → dynamic 自步由**服务端 statsig flag** 控制（codename **"kairos"** = loop/proactive 特性族；同族 `isKairosCronEnabled` 控制 `/loop` 本身是否启用）。本会话该 flag **OFF**，故 rule 3 退化为「默认 10m cron」。`ScheduleWakeup` 工具仍存在（dynamic 模式专用唤醒：*"call before ending the turn to keep the loop alive; stop:true to end"*），但入口被 flag 关闭。`tengu_` 前缀属同一 statsig 命名空间（共 50+ 个，如 `tengu_auto_mode_config`）。

---

## 3. 触发机制（端到端） 🧪【实测】+ 📋【工具描述】

```
/loop 5m 做X
 ① Skill(loop) → getPromptForCommand → 注入「调度指令」user 消息 🧪
 ② 模型按模板把 5m → cron */5 * * * *
 ③ CronCreate → 【auto-mode 分类器】安全闸门 🧪（见 §5）
 ④ 模型立即执行一次 prompt + 确认调度信息
 ⑤ 定时器：cron 到达 + REPL 必须空闲 才触发 📦🧪（见 §6）；recurring 每 7 天自动过期 📋
 ⑥ 把 prompt 原文 作为 isMeta/promptSource=system 的 user turn，queuePriority=later 注入同 session 🧪
 ⑦ CronDelete(jobID) 随时取消；session-only 随进程退出消失 📋
```

**实测时序样本** 🧪：`5331c441`（`*/2`）14:38:36 建立 → **:40 边界因 REPL 忙被跳过** → **:42:40 才触发**。

---

## 4. 一次 cron 触发的解剖（transcript 实测） 🧪【实测】

对 fired cron turn 做 JSONL 取证 🧪：

| 字段 | 值 | 来源 |
|---|---|---|
| `type` / `message.role` | `user` / `user` | 🧪 |
| **`message.content`** | **= CronCreate 的 `prompt` 字段，一字不差；无 `<system-reminder>`、无 job-id/时间戳前缀** | 🧪 |
| `isMeta` | `true` | 🧪 |
| `promptSource` | `"system"` | 🧪 |
| `promptId` | `<uuid>` | 🧪 |
| `queuePriority` | `"later"` | 🧪 |
| `permissionMode` | `"auto"` | 🧪 |

> 模型**看到的文本** = `prompt` 原文；harness 靠**元数据字段**区分"cron 触发"而非真人输入。

**三种"提示词"勿混** 🧪💡：① `/loop` 调度指令模板（只出现一次，不存进 cron）；② CronCreate 的 `prompt`（存进定时器、每次重放）；③ 触发时模型收到的（= ② + 元数据）。

---

## 5. 安全闸门：auto-mode 分类器（Instruction Poisoning） 🧪【实测】

CronCreate 的 payload 被 auto-mode 分类器检查 🧪。用 5 个探针（cron 设在 `0 9 1 1 *`，本会话不触发）测出边界图：

| 让未来 session 干什么 | 判定 | 来源 |
|---|---|---|
| 良性动作（报时间 / git status） | ✅ 放行 | 🧪 |
| 读 transcript、总结会话讨论主题（**对话历史**） | ✅ 放行 | 🧪 |
| 报元数据字段值（promptId / promptSource） | ✅ 放行 | 🧪 |
| 复述自身被唤醒时收到的**完整 prompt / wrapper / sentinel** | ❌ 拦 [Instruction Poisoning] | 🧪 |
| 输出 **system / developer 层指令内容** | ❌ 拦 [Instruction Poisoning] | 🧪 |

**规则** 🧪💡：闸门针对"让未来 session **外泄/复述其 prompt 内部内容**"（system / developer / cron-prompt 的文本与结构），尤其"用户不在注视时"触发的定时外泄。**良性任务、读对话历史、报元数据字段值一律不拦。** 即使可能误报，默认仍拦。

**Composite 连坐** 🧪【实测】：分类器按**一个响应里的整个 CronCreate 批次**做评估——若任一 payload 有毒，**同批全部拦截**（哪怕其中混有良性项）。实测：C（有毒）+ D（良性）同批 → 两者皆拦；D 单独重测 → 放行。
⇒ **实用**：同回合建多个 cron 时必须全部良性，否则良性的也会被连坐；要测某个 payload，单独发。

---

## 6. 密集 cron / 并发行为（重点）

### 6.1 会在工作过程中收到下一个 cron prompt 吗？—— 不会 📦🧪

- 二进制原文 📦【解包】：`grep -a "not mid-query" claude.exe` → **"Jobs only fire while the REPL is idle (not mid-query)."**
- 工具描述 📋 同此义。
- **直接实测** 🧪【实测】：`2a5a6317`（`* * * * *`）触发后，我执行 `sleep 75`（15:09:31→15:10:46，**横跨 15:10:00 边界**，cron 全程存活）；睡前/睡后点数 transcript 里 `EXP-DENSE` 触发记录 **1 → 1，delta = 0**。⇒ **mid-query 75s 窗口内零注入**。

### 6.2 harness 会催促快点完成上一个吗？—— 不会 📦【解包】

- `nudge` 在二进制出现 100 次，**全部无关** 📦：`rc-long-turn-nudge`/`rc-permission-nudge`/`rc-idle-upsell`/`push-idle-upsell`/`fast-mode-cooldown-*`（UI/限流）。
- `coalesce`→QUIC `received coalesced datagram`；`backlog`→Node `net.createServer({backlog})`；`preempt`→无关段；`routine-fired`→**遥测事件名**（与 `startup-notice` 同列），非催促。
- ⇒ **调度器无积压/催促/抢占逻辑**。

### 6.3 错过的触发会怎样？—— 跳到下一边界，不堆积 🧪【实测】

两个独立实测点 🧪：
1. `5331c441`（`*/2`）：:40 忙→跳过，:42 才触发（非"一空闲就补"）。
2. `2a5a6317`（`* * * *`）：15:04 建立，15:05/15:06 边界我在写文档（忙）→ **均跳过**，**只在 15:07:23 触发了一次**（不是补发 3 条）。

⇒ recurring 每个边界独立评估；忙则丢弃该次，等下一个；**不补发、不排队**。抖动：recurring 最多延迟 period 的 10%（上限 15 min） 📋。

### 6.4 实用推论 💡【推断】

- 有效频率 = max(间隔, 任务耗时)；设更密只是丢边界。
- 长 turn 期间所有 cron 挂起，turn 后只在下一边界触发一次，**不会收到积压串**。
- 事件驱动场景别用 cron（轮询，长任务期会漏）→ 用 hook/监视器/事件流。

---

## 6.5 ScheduleWakeup：/loop 的自步引擎（与 cron 对立）

### 是什么 📋【工具描述】+ 📦【解包】

`/loop <任务>` **不带间隔**时走"自步"路径：模型每轮干完活 → 自己选 delay → 调 ScheduleWakeup 排**下一次**唤醒 → 回合结束 → 唤醒到达后重入循环 → 再排……直到 `stop:true` 或达最大时长。

**参数**：`delaySeconds`（钳制 [60,3600]）／`reason`／`prompt`（/loop 输入逐字回传；无任务自步传哨兵 `<<autonomous-loop-dynamic>>`）／`stop:true` 终止。

**三种返回**（二进制 📦）：

| 触发 | 返回文案 |
|---|---|
| `stop:true` | `Loop stopped — <reason>. …` |
| 排不成（gate 关 / 达最大时长） | `Wakeup not scheduled. Either the /loop dynamic runtime gate is off or the loop reached its maximum duration — the loop has ended; do not re-issue.` |
| 排成 | `Next wakeup scheduled for HH:MM:SS (in Ns) (clamped to Ts from your requested value). Nothing more to do this turn — the harness re-invokes you when the wakeup fires **or a task-notification arrives**.` |

⇒ **双唤醒源**：定时到 **或** 后台任务/监视器完成（task-notification）都会重新触发；delay 超界会 clamp 并告知。

### vs CronCreate

| | CronCreate | ScheduleWakeup |
|---|---|---|
| 节奏 | cron 表达式（固定） | 模型每次自选 delay |
| 排程 | recurring / one-shot | 只排下次（自步靠反复调用） |
| 持久 | 可 `durable` | session-only（无 durable 参数） |
| 唤醒源 | 仅定时 | 定时 **或** task-notification |
| cache-aware | — | 专门指导：避 300s，默认空转 1200–1800s |

### 运行时闸门与实现 🧪【实测】+ 📦【解包】

**直接调用被拒** 🧪：本会话调 `ScheduleWakeup(delay=90s, 良性 prompt)` → 返回上述"排不成"文案。

**Gate 已确认** 📦：`function tQe(){ return nt("tengu_kairos_loop_dynamic",!1) }` —— dynamic runtime gate **就是这个 statsig flag 本身**（默认 false）。flag OFF → `WBt("gate_off")` → `scheduledFor:0` → 拒。

**maxDuration** 📦：循环最大寿命 = `jyt().recurringMaxAgeMs`，**与 recurring cron 的 max-age 同源**（~7 天 `DEFAULT_MAX_AGE_DAYS`，服务端可覆盖）。超龄 → 遥测 `tengu_loop_dynamic_wakeup_aged_out{loop_age_ms,max_age_ms}` → 返回 null → 拒。⇒ **dynamic 循环也约 7 天自动过期**，与 cron 一致。

**auto 模式同样过分类器** 📦：`permissions` 在 mode==="auto" 时返回 *"Scheduling a /loop wakeup requires classifier review"* —— Instruction Poisoning 对 ScheduleWakeup **同样适用**。

**`stop:true` 只停 dynamic loop，不停 recurring cron** 📦：原文 *"If you are running a fixed-interval /loop (a recurring cron), it is NOT stopped by this call — cancel it with CronDelete"*；它只取消 `kind==="loop"` 的唤醒。

**keepalive 自动续命** 📦：模型忘重新调度时，系统自动 arm 回退唤醒 `Br_=1200s`（20min，与工具描述"lean 1200–1800s"吻合）；budget `zr_=1`（续一次后仍不调度→结束）。由 env `CLAUDE_CODE_LOOP_KEEPALIVE` 或 flag `tengu_kairos_loop_keepalive` 开关。

**cache-aware 调度** 📦：延迟在 5min 缓存窗（`ddn=300s`）内时，调度器按 60s 步长**回拨**唤醒时刻贴住缓存（减 `cacheLeadMs`）——这是工具描述"避开 300s 缓存失效崖"的代码实现。delay 钳制 `[Sdn=60, vRo=3600]`s。

**架构统一** 📦：dynamic 唤醒**底层存成 cron 条目** `{id, cron:"M H * * *", prompt, kind:"loop"}`，与普通 cron 共用存储，仅以 `kind:"loop"` 区分。⇒ ScheduleWakeup ≈ 模型自定、`kind:"loop"`、随用随消的 cron；`SL().filter(n=>n.kind==="loop")` 即全部动态唤醒。

⇒ **本会话无法实测 fire 形态**：flag OFF，调用即拒。

### "kairos" 特性族 📦【解包】

`/loop`、自步、主动代理同属 codename **kairos** 的 statsig flag 家族（`tengu_kairos_*`）：`kairos_loop_dynamic`（自步）、`kairos_loop_persistent`(_activated)（持久/云循环）、`kairos_loop_keepalive`、`kairos_loop_prompt`、`kairos_cron_durable`（durable cron）、`kairos_brief`／`kairos_push_notifications`／`kairos_ready_nudge`／`kairos_input_needed_push`（UI 推送/主动提醒）。本会话相关项均 OFF → 只剩最简 cron 循环可用，ScheduleWakeup 形同禁用。

---

## 7. 和 "goal" 的关系 💡【推断】

**循环里没有独立 goal 对象** 💡。`CronCreate.prompt` 本身就是 goal，靠每次逐字重放保持任务：

- `promptId` 只串联同一次调度的各次记录，**不承载演化状态** 🧪。
- 2.1.226（纯 cron）= 无状态、每隔 N 分钟重放同一句，goal 不进化。
- 2.1.113 dynamic 自步（当前关）会用 `ScheduleWakeup` 自选延迟，但 `prompt` 仍是 `/loop <原始输入>` 原文回传 📦。

> 本节为机制推理 💡，非直接抓取到的 "goal" 字段（线上未见独立 goal 结构）。

---

## 8. 实用建议 💡【推断】+ 📋【工具描述】

1. 间隔别小于任务耗时（否则只丢边界）。
2. prompt 写自包含（每次重放是独立 turn）。
3. 别让 cron prompt 做"外泄"动作（分类器拦，见 §5）。
4. 临时实验用 session-only（默认）；跨会话才 durable（写 `scheduled_tasks.json`）。
5. one-shot（`recurring:false`）fire 一次自删；recurring 每 7 天自动过期。
6. 事件驱动用 hook 不用 cron。

---

## 9. 复现 / 取证脚本

### 9.1 读 transcript 里某条 fired cron 的完整结构 🧪
```bash
node -e '
const fs=require("fs");
const p="<session transcript>.jsonl";
for(const l of fs.readFileSync(p,"utf8").split("\n").filter(x=>x.trim())){
  let o;try{o=JSON.parse(l);}catch(e){continue;}
  if(o.type==="user"&&o.promptSource==="system"&&JSON.stringify(o.message&&o.message.content).includes("<prompt 标记>")){
    console.log({isMeta:o.isMeta,promptSource:o.promptSource,promptId:o.promptId,
      queuePriority:o.queuePriority,ts:o.timestamp,content:o.message.content});break;}}
'
```

### 9.2 mid-query 不打断实验 🧪
```bash
# 建每分钟 cron（良性任务）→ 触发后跑 sleep 75 → 睡前/睡后数 transcript 触发数
# 期望：delta = 0（详见 §6.1）
```

### 9.3 反查运行版调度器文案 📦
```bash
B="/c/Users/Administrator/.local/bin/claude.exe"
grep -a -b -o "not mid-query" "$B"      # 定位"仅空闲触发"
# dd skip=<off-N> count=... | tr -d '\000'  取上下文
```

---

## 10. 未决 / 可继续调研

- [x] ~~coalesce/backlog 是否与 cron 并发有关~~ → 📦 已确认无关（网络/socket 误命中）。
- [x] ~~routine-fired 是否催促机制~~ → 📦 遥测事件名，非催促。
- [x] ~~mid-query 是否被打断~~ → 🧪 已确认不（sleep 75 delta=0）。
- [x] ~~错过边界是否堆积~~ → 🧪 已确认不（5331c441 / 2a5a6317 各只补一次）。
- [x] ~~Instruction Poisoning 闸门的精确边界（哪些措辞拦/放）~~ → 🧪 已测：5 点边界图 + composite 连坐（见 §5）。
- [x] ~~dynamic 自步模式（`ScheduleWakeup`）在哪些环境/flag 下开启~~ → 📦 服务端 statsig flag `tengu_kairos_loop_dynamic`（本会话 OFF）。
- [x] ~~ScheduleWakeup 能否在本会话实测 fire 形态~~ → 🧪 不能：调用即被 runtime gate 拒（见 §6.5）。
- [x] ~~durable cron 是否被 `kairos_cron_durable` 独立 gating~~ → 🧪 本地 `durable:true` **未被 gate**：成功写入 `.claude/scheduled_tasks.json`（删除后文件消失）。`kairos_cron_durable` 疑似管云端/跨机持久 cron 变体 💡，非本地。
- [x] ~~dynamic 循环 `maxDuration` 的具体上限~~ → 📦 = `jyt().recurringMaxAgeMs`，与 cron 的 ~7 天 max-age 同源（见 §6.5）。
