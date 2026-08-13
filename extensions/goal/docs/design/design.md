# Goal Extension 设计文档

> **状态**：设计中（未实现）。基于 Codex / Claude Code / Hermes 三家调研。
> **姐妹文档**：`docs/research/goal/claude-code.md`（Claude Code 解包）、本目录 `adr/`（决策记录）

## 背景

### 问题

pi 的 agent 默认是"问一句答一句"——模型觉得做完了就停。但很多真实任务是"做到 X 为止"：

- "修完 `src/` 里所有 lint 错误，验证 `ruff check` 通过"
- "把功能 X 从仓库 Y 移植过来，带测试，CI 变绿"
- "调查会话 ID 漂移的根因并写报告"

这些任务需要 agent **自主跨轮迭代**，而不是每轮停下来等用户说"继续"。没有 goal 机制时，用户得反复手动催"继续"，或依赖 cron（时间驱动，但"每 N 分钟做一次"不等于"做到完成为止"）。

### 为什么需要 goal（完成驱动）

pi 的三种"继续/循环"机制定位（对照 Claude Code 生态）：

| 机制 | 驱动 | 语义 | pi 对应 |
|---|---|---|---|
| **goal** | 完成驱动（条件达成才停） | "做到 X 为止" | 本扩展 |
| cron | 时间驱动（时刻表） | "每 N 做 X" | 待实现 |
| 自步（scheduleWakeup） | 模型自选延迟 | "边等边做" | 待实现 |

goal 填补的是"**无人值守跑到完成**"这一档——这正是 web-console 场景的最大价值（手机发个任务，让 agent 自主跑完）。

### 为什么不直接用现有方案

- **纯 cron**：时间驱动，无法表达"完成才停"。任务 3 分钟做完和 30 分钟做完，cron 都按固定间隔戳，要么浪费要么提前停。
- **agent 自管理（Codex 路线）**：让 agent 自己调工具声明完成。轻量无裁判成本，但**信任 agent 自述**——agent 可以"自吹"说做完了（详见 ADR-002）。与本项目"对抗自吹"的诉求冲突。
- **手动催**：退化到"问一句答一句"，违背自主迭代目标。

## 三家调研对照（设计根基）

本设计是对开源生态三套"完成驱动循环"机制的综合。完整调研见 `docs/research/`，这里只列对本设计有实质影响的关键差异：

| 维度 | Codex（Ralph loop 源头） | Claude Code | Hermes | **本扩展取舍** |
|---|---|---|---|---|
| 谁判定完成 | agent 自己（工具） | 独立裁判 | 独立裁判 | **独立裁判**（ADR-002） |
| 对抗自吹 | prompt 软约束 | 裁判保守判定 | **gates 确定性短路 + contract** | **裁判硬性要求证据**（ADR-003） |
| 裁判判定态 | —（agent 自报） | 2 态 ok/not-ok | 3 态 done/continue/wait | **4 态**（+impossible，ADR-006） |
| 裁判上下文 | — | 整个 transcript | **只读最后回复 ~4KB** | **只读最后回复**（避免续行噪音污染） |
| 续行形态 | 内部 fragment（不进 transcript） | stopHook 旗标重跑 | user message（进 transcript） | **user message**（裁判不读 transcript 故无污染） |
| 预算 | **token + 时间** | 连续阻止 8 | turn（20） | **总量可选（默认不限）+ 信号硬默认**（ADR-004） |
| 状态机 | 6 态 | 隐式 | 4 态 | **4 态**（active/paused/done/failed） |
| 无人值守处理 | — | impossible 立即停 | impossible 立即停 | **solo 属性**（默认 true，impossible 韧性，ADR-006） |
| 模式可用性 | feature flag 灰度 | 仅非交互/远程 | 全模式 | **全模式**（ADR-005） |

**核心判断**：主线走 Hermes/Claude Code 的**独立裁判路线**（不信任 agent 自述，对抗自吹），吸收 Codex 的 token 预算思想，并新增 solo 属性解决无人值守的差异化处理。理由见各 ADR。

## 架构

### 核心循环

```
用户: /goal <条件>  ──▶  registerCommand handler
                          ├─ 解析（可选 --solo / --no-solo）
                          ├─ setGoalState({ status:"active", ... })
                          ├─ appendEntry("pi-goal", state)  持久化
                          └─ sendUserMessage(start prompt)  触发第一轮 ⚡
                                   │
                                   ▼
        agent 开始第一轮工作（start prompt 触发，非用户首条消息）
                                   │
                          agent_settled 事件 ◀──┐
                                   │            │
                          ├ goal 非 active? ──▶ return（不干预）
                          ├ 跑裁判（modelRegistry.complete，独立调用）
                          │   verdict = done      ──▶ clear, notify ✅         │
                          │   verdict = continue  ──▶ 续行（带 gaps）──────────┤
                          │   verdict = wait      ──▶ park(截断秒数)，到期检查前置续行 ─┤
                          │   verdict = impossible─┤                          │
                          │     solo: 换方向续行(agent自找方向), streak++    │
                          │            streak≥3 → pause                      │
                          │     非solo: 直接 pause                           │
                          ├ 预算/信号计数检查                                  │
                          │   超限 ──▶ pause/failed, notify                  │
                          └ 续行 ──▶ sendUserMessage(续行 prompt) ────────────┘
                                   │  （触发新 turn）
                                   └──────────────────────────────────────────┘
```

### 数据流要点

1. **续行是普通 user message**（`pi.sendUserMessage`，进 transcript）。简单、可读、pi 原生支持。
2. **裁判不读 transcript**，只读「goal 条件 + agent 最后一条回复（截断）」。因此续行消息堆在 transcript 里**不会污染裁判**——裁判根本不看它们。
3. **裁判硬性要求证据**：agent 必须提供命令输出/文件内容/测试结果，不接受无证据自述（详见 §4）。
4. **solo 实时生效**：续行 prompt 和 judge 调用时实时读 goal 当前的 solo 值，不固化于创建时。

## 核心机制

### 1. 命令与状态

| 命令 | 功能 |
|---|---|
| `/goal <条件>` | 设置（或替换）goal。条件里应包含"什么情况算完成"的停止标准。默认 solo=true。 |
| `/goal --solo <条件>` | 创建时显式无人值守 |
| `/goal --no-solo <条件>` | 创建时显式有人值守 |
| `/goal` 或 `/goal status` | 显示当前 goal、状态、已用预算、solo 值 |
| `/goal pause` | 暂停循环（不清除 goal） |
| `/goal resume` | 恢复循环（重置连续计数） |
| `/goal clear` | 清除 goal |
| `/goal solo on\|off` | 事后切换 solo（不丢进度，实时生效） |

> **停止标准写在条件里**：goal 条件是自然语言，用户直接在里面说明"什么情况才算完成"（如"修完 lint 错误，ruff check 通过为止"）。裁判 LLM 据此判断 done/continue，不需要结构化的 contract/gates 语法。
>
> ~~contract（inline verify/constraints/boundaries）~~、~~gates（确定性命令短路）~~、~~/subgoal~~ 已废弃——用户手写结构化语法太重，且 Claude Code/Codex 都没用，纯 LLM 裁判已足够（详见 ADR-003）。

### 2. 触发：agent_settled

监听 `pi.on("agent_settled", handler)`。这是 pi 认定"agent 彻底空闲、不会再自动继续"的时刻，最贴近 Stop hook 的"模型想停"语义（详见 ADR-001）。

不用 `turn_end`：每个 turn 都触发，但模型可能还在中途（刚做完工具要进下 turn），判停太早。
不用 `agent_end`：单次 agent run 结束，但 pi 可能自动重试/compact 后继续。

### 3. 裁判：独立调用 + 4 态裁决

裁判是一次独立的 `ctx.modelRegistry.complete(judgeModel, { systemPrompt, messages }, { cacheRetention:"none", sessionId:uuidv7() })` 调用（同 pi 示例 `summarize.ts`/`handoff.ts`），**不经过 session 循环、不继承主 agent 的 system prompt**。

**输入**（只读局部，不读 transcript）：
- goal 条件（含用户写的停止标准，如"ruff check 通过为止"）
- agent 最后一条 assistant 回复（截断 ~4KB）

**输出 schema**：
```ts
type Verdict = {
  status: "done" | "continue" | "wait" | "impossible";
  reason: string;
  gaps?: string[];          // continue：具体还差什么，回喂 agent
  evidence?: string[];      // done：达成证据（tool result 级，对抗自吹）
  wait?: { pid?: number; seconds?: number };  // wait：等什么
}
```

> **impossible 不带 alternative**：judge 信息少（只看最后回复 + goal），给替代方向易瞎指挥。judge 只负责「判定此路不通 + 诊断原因（reason）」，换什么方向由 agent 自己想（它有完整上下文）。

**回复解析与重试**（兼容多种格式 + 格式错时反馈重试）：

```
raw → 剥离 markdown code fence（```json ... ```）
    → 尝试直接 JSON.parse
    → 失败则正则提取首个 { ... }
    → 验证 status（4 态之一）+ reason（字符串）必填
    → 成功 → verdict；失败 → 返回具体 parseError
```

解析失败 → **重试**（最多 2 次），用**多轮对话结构**（让模型明确看到自己上次的错误输出，修正更有针对性）：
```
systemPrompt: 裁判 system（每次不变）
messages（累积）：
  第1次: [{user: 原始prompt}]
  重试1: [{user:原始}, {assistant:上次错误输出(截断)}, {user:"[格式错误] 上次输出：{raw} 错误：{parseError} 请只输出JSON"}]
  重试2: [{user:原始}, {assistant:错误1}, {user:修正1}, {assistant:错误2}, {user:修正2}]
```
用多轮而非单轮拼进 user：assistant role 让模型明确"这是我上次说的"，对照自己的输出修正比看 user 里的引用更有效（标准对话修正模式）。上次 assistant 输出截断防爆 token。

**计数**：一个裁判周期 = 第 1 次 + 最多 2 次重试。周期内任一次成功 → parse failure 计数归零；全失败 → 计数 +1，verdict 当 continue（fail-open）。`consecutiveParseFailures ≥ 3` → pause（防坏 judge 烬预算，见 §6）。

**裁判 system prompt 要点**（硬化 evidence 定义，对抗自吹）：
- 只接受 tool result 级证据（命令输出/文件内容/测试结果），**不接受** "done"/"all tests pass" 这类无证据自述
- 缺证据 → continue（保守默认，continue 是兜底态）
- impossible 时给清晰 reason（此路为何不通），换方向由 agent 自己想（judge 信息少不瞎指挥）
- **识别 agent 显式求助**（"需要用户确认"）→ 不当 done，按 solo 映射（见 §9）
- solo 模式 done 更严（误判完成代价大）、impossible 不立即停（见 §9 韧性处理）
- **精简输出**：reason 一句话，gaps/evidence 简短条目（每条一两句），只输出 JSON 不附解释——省 token、格式更稳

**4 态完整规格见 §10**。

### 4. 防自吹：裁判要求证据

裁判 system prompt 硬性要求：agent 必须提供 tool result 级证据（命令输出/文件内容/测试结果），不接受"完成""测试通过"等无证据自述。缺证据 → continue。

> ~~gates（确定性命令短路）~~ 和 ~~contract（结构化验收语法）~~ 已废弃（详见 ADR-003）。纯 LLM 裁判要求证据已足够，且 Claude Code、Codex 均未采用确定性验证。

### 5. 续行：sendUserMessage（prompt 随 solo 变）

裁判判 `continue` → `pi.sendUserMessage(续行 prompt, { deliverAs:"followUp" })`，触发新 turn。

续行 prompt 模板（带 gaps；**末句随 solo 变**）：
```
[继续朝目标推进]
目标：<condition>
裁判指出差距：<gaps>

继续工作。如果你认为目标已完成，明确说明并附证据（命令输出/文件内容）。
<非 solo 末句：如果卡住需要用户输入，明确说明并停。>
<solo 末句：不要停下来等人——自主推进。遇到决策点选最合理的方案继续。如果你在等待异步工作（build/test/CI），先检查其状态：若已完成报告结果；若未完成，明确报告预计剩余秒数然后停下（会定时回来，不要反复空转检查）。>
```

**为什么进 transcript 没关系**：裁判只读最后回复，不看 transcript 历史，所以续行消息堆叠不污染裁判。

### 6. 预算：总量可选 + 信号硬默认

**总量预算与信号预算职责分离**（详见 ADR-004）：

- **总量预算（用户可选，默认都不限 `null`）**：
  - `tokenBudget`：从每轮最后一条 assistant 的 `usage.totalTokens` 累计 `goal.tokensUsed`，超限 → pause。关心成本时设。
  - `maxTurns`：turn 计数（`goal.turnsUsed`，每轮 `agent_settled` 时 `++`），超限 → pause。想限轮数时设。
- **信号预算（系统硬默认，不可关）**——防死循环的真正防线：
  - `soloImpossibleCap` = 3：solo 模式连续 impossible ≥ 3 → pause（见 §9）
  - 连续裁判解析失败 ≥ 3 → pause（防小模型不守 JSON 契约）
  - 连续裁判传输失败 ≥ 5 → pause（防坏 API key 烬预算）

默认行为：goal 一直跑到"真达成 / 真 impossible（连续 3 次）/ 裁判坏了 / 用户 clear"为止——纯粹的"做到完为止"语义。预算耗尽是 **pause（可 resume）**，不是 failed。

> **为什么总量默认不限而信号硬默认**：总量（token/turn）是"用户愿花多少"的主观选择，系统不该替用户定；信号（连续撞墙/裁判坏）是客观的死循环征兆，必须默认防护。

### 7. 状态机

```
                 /goal <条件>
                      │
                      ▼
                  ┌───────┐
        ┌────────▶│ active │◀──── /goal resume ────┐
        │         └───┬───┘                        │
        │             │                            │
   continue/       done ──▶ done                   │
   wait恢复       impossible(非solo)──▶ pause ─────┤
   impossible(solo,    impossible(solo,           │
     streak<3)换方向     streak≥3)──▶ pause ───────┤
        │                                          │
        │      预算/信号超限 ──▶ pause ────────────┤
        └──────────────────────────────────────────┘
                              │ /goal clear
                              ▼
                       (goal 清除)
```

四态：`active`（循环中）/ `paused`（用户暂停或预算/信号触发，可恢复）/ `done`（达成）/ `failed`（连续 impossible cap 或连续裁判失败超限）。

**三个计数器**（各自独立，互不干扰）：
- `impossibleStreak`：连续 impossible 次数，≥ soloImpossibleCap(3) 触发 pause。返回非 impossible（done/continue/wait）时归零；`/goal resume` 重置。
- `consecutiveParseFailures`：judge 输出非 JSON，≥ 3 pause。
- `consecutiveTransportFailures`：judge API 调用失败，≥ 5 pause。

### 8. 持久化与恢复

- **持久化**：goal 状态用 `pi.appendEntry("pi-goal", state)`，custom entry **不进 LLM context**（正合适——goal 状态是控制面数据，不该污染对话）。
- **恢复**：`pi.on("session_start", …)` 扫 entries，取最后一条有效 goal entry 恢复。对应 Claude Code `restored_on_resume`。
- **重启后恢复循环**：服务重启后（如 `restart_server`）`recoverPendingSession` 恢复 session 但**不自动 continue**（防 restart_server 自循环），导致 agent idle 无 `agent_settled`，goal 循环卡死。修复：`session_start` 恢复 active goal 后，延迟 2s `sendContinuation(force=true)` 踢一脚恢复循环。
- **跨 compaction 恢复**：`session_compact` 事件检测 active goal，主动 `sendContinuation` 恢复循环。根因是竞态：`compact()` → `abort()` → `waitForIdle()` 期间 `agent_settled` 触发，裁判跑完排了 `setTimeout(0)` 续行；但 `compact()` 在 microtask 链里同步设置 `_compactionAbortController` 锁，`setTimeout(0)` 作为 macrotask 必然在锁之后 fire，`sendUserMessage` 抛 `"Cannot submit a prompt while compaction is in progress"`。两层防护：①`sendContinuation` 的 setTimeout 回调加 try/catch 静默吞掉异常；②`session_compact` handler 在压缩完成后补发续行。overflow/threshold 自动压缩不受影响——agent loop 内部重试，`agent_settled` 在锁释放后才触发。

### 9. solo 属性（无人值守的差异化处理）

详见 ADR-006。solo 是 goal 的属性（非全局模式），默认 `true`（含 TUI），影响三处：

| 影响点 | solo（默认） | 非 solo（`--no-solo`） |
|---|---|---|
| 续行 prompt 末句 | 不鼓励求助，行动导向 | "卡住可明确说明并停" |
| judge **impossible** 处理 | **韧性**：不停止，换方向续行（agent 自找方向），连续 ≥ 3 才 pause | 直接 pause 让人决策 |
| judge **done** 严格度 | 更严（误判完成代价大，证据不充分 → continue） | 正常力度 |
| judge **wait** 处理 | agent 估算剩余秒数 → 截断 `min(s, maxWaitSeconds=600s)` → park（不烧 turn）；park 到期检查 `goal.active && isIdle()` 才续行；无目标/被抢占则降级/取消（见 §10） | 通知人，人决定 |

**impossible 韧性**（solo 核心）：多数 impossible 是"此路不通"而非"目标不可达"。solo 模式不立即停，续行 prompt = `"当前路径不通：<reason>。换一个方向继续，重新审视目标，自己寻找替代的实现路径/工具/假设。"`（judge 只给原因，不给方向——它信息少；agent 有完整上下文，自己想方向更靠谱），`impossibleStreak++`。连续 3 次说明"不是路径问题，是目标/信息问题"，真 pause。

**agent 求助识别**（横切）：agent 显式说"需要用户确认/被阻塞" → judge 识别，不当 done，按 solo 映射：solo → impossible（走连续 cap，续行鼓励 agent 用合理默认值自主推进）；非 solo → 直接 pause。

### 10. judge 4 态完整规格

| status | 何时返回 | 必带字段 | 处理（solo / 非 solo） |
|---|---|---|---|
| **done** | 最后回复明确确认完成 + 具体证据（tool result），| `reason` + `evidence[]` | 都 clear ✅；solo 证据要求更严 |
| **continue** | 未达成，有具体下一步。**默认/兜底态**——拿不准就返回它 | `reason` + `gaps[]` | 都续行（带 gaps）；prompt 末句随 solo 变 |
| **wait** | 未达成，但该等异步（CI/build/长任务），现在戳是 busy-work | `reason` + `wait{seconds}`（pid 感知为未来增强） | park 不烧 turn；**agent 估算秒数截断** `min(s, maxWaitSeconds)`；到期检查前置条件才续行；无 seconds 降级 continue（见下） |
| **impossible** | 此路不通（做不到/被阻塞/缺关键信息）。多数是"此路不通"非"目标不可达" | `reason`（不带方向建议） | solo 韧性（agent 自找方向，连续 3 次才停）；非 solo 直接 pause |

> judge **只判"目标达没达成"**，不判"该不该问人"。需人的情况由 agent 显式求助（→映射 impossible）+ 连续 cap 兜底。这是"只读最后回复"局限的缓解——judge 不需要承担"判断是否需人"的复杂负担。

**wait 生命周期**（完整流程，事件驱动取消）：

```
judge 判 wait{seconds}
  → 截断 min(seconds, maxWaitSeconds=600s)     // 防 agent 估离谱大数
  → park（setTimeout，不烧 turn/不调裁判）+ 注册 agent_start 监听
     ├ ① 到期 + goal.active + isIdle() → 正常续行（戳 agent）
     ├ ② agent_start 触发 → agent 被外部驱动（用户消息等）→ clearTimeout，不发
     │    （agent 处理完后 agent_settled 会自然重新触发裁判，goal 循环自接接回）
     └ ③ /goal pause | clear → clearTimeout（goal 不再 active）
judge 判 wait 但无 seconds → 降级 continue（park 在什么上？直接戳）
```

设计要点：wait 的价值是 **park（不烧 turn）**，避免异步工作未完成时 busy-work 反复戳 agent。"等多久"靠 agent 估算（它最清楚自己在等什么），judge 只提取秒数；pi 无进程感知故用秒数而非 pid（pid 感知为未来增强，进程退出即恢复、零浪费）。**取消用事件驱动（agent_start）而非轮询**——agent 被外部驱动时零延迟取消，且取消后无需 goal 补发任何消息（agent_settled 会接管）。用 agent_start 而非 turn_start：前者标志"idle→开始一次 run"的边界（正是要检测的转换），后者是 run 内部每个 turn 的开始、粒度过细。

## 配置与 Prompt 模板

配置支持两级合并（优先级：内置默认 < 全局 < 项目级）：

- **全局**：`~/.pi/agent/goal.json`——所有项目共享的默认值
- **项目级**：`{cwd}/.pi/goal.json`——覆盖全局，仅当前项目生效

分三部分：**数值/行为配置**、**Prompt 模板**（均有内置默认，按需覆盖）、**占位符**（prompt 里引用运行时数据）。

### 数值/行为配置

```jsonc
{
  "solo": true,              // 无人值守默认（全局，含 TUI）；--no-solo / /goal solo off 覆盖
  "judgeModel": null,        // 裁判模型 "provider/modelId"；null=用当前模型
  "judgeMaxTokens": 1024,    // 裁判输出 token 上限；reasoning 模型需更大（隐藏推理烧 token，Hermes 用 4096）
  "tokenBudget": null,       // 总量：token 预算；null=不限（默认）
  "maxTurns": null,          // 总量：turn 预算；null=不限（默认）
  "soloImpossibleCap": 3,    // 信号：solo 连续 impossible 次数上限
  "maxParseFailures": 3,     // 信号：裁判连续解析失败上限
  "maxTransportFailures": 5, // 信号：裁判连续传输失败上限
  "maxWaitSeconds": 600,     // solo wait 超时兜底（转 continue）
  "judgeResponseChars": 4000,// 喂给裁判的最后回复截断长度
  "maxFormatRetries": 2      // 裁判格式错误重试次数（带错误反馈，见 §3）
}
```

裁判模型默认用当前模型（保证一定能跑），建议配廉价快速模型。pi 里通过 `ctx.modelRegistry.find(provider, modelId)` + `hasConfiguredAuth` 解析。

### Prompt 模板（可覆盖）

所有 prompt 均有**内置默认**（即本文档各处设计的那些措辞）。用户只需覆盖想改的（deep merge，未覆盖的用默认）。配置 key：

```jsonc
{
  "prompts": {
    "systemSolo":       "...",  // goal active 时注入 system（solo 版）
    "systemAttended":   "...",  // goal active 时注入 system（非 solo 版）
    "continueSolo":     "...",  // continue 续行（solo）
    "continueAttended": "...",  // continue 续行（非 solo）
    "impossible":       "...",  // impossible 韧性续行（solo 专属）
    "waitResume":       "...",  // wait 恢复续行
    "gateFailed":       "...",  // gate 失败续行
    "judgeSystem":      "...",  // 裁判 system prompt
    "judgeUser":        "...",  // 裁判 user prompt
    "judgeRetry":       "..."   // 格式错误重试追加的 user prompt
  }
}
```

### 占位符

prompt 模板里用 `{{name}}` 引用运行时数据。无值/不适用时渲染为空字符串。列表类（gaps/evidence）渲染为 `- item\n` bullet 块。

| 占位符 | 含义 | 适用 prompt |
|---|---|---|
| **goal 元数据** | | |
| `{{goal}}` | goal 条件文本 | 所有 |
| `{{solo}}` | "true"/"false" | 所有 |
| `{{turnsUsed}}` | 已用 turn 数 | 所有 |
| `{{impossibleStreak}}` | 当前连续 impossible 次数 | impossible |
| `{{soloImpossibleCap}}` | impossible cap 配置值 | impossible |

| **主 agent 上下文** | | |
| `{{lastResponse}}` | 主 agent 最后回复（截断） | judgeUser |
| **judge verdict 字段**（续行引用上次裁判结果） | | |
| `{{judgeStatus}}` | done/continue/wait/impossible | 续行 |
| `{{judgeReason}}` | judge 的 reason | 续行 / impossible |
| `{{judgeGaps}}` | gaps（渲染为 bullet 块） | continue 续行 |
| `{{judgeEvidence}}` | evidence（渲染为 bullet 块） | （调试/通知用） |
| `{{judgeWaitSeconds}}` | wait 秒数 | waitResume |

| **格式重试** | | |
| `{{parseError}}` | 错误描述（如 "not valid JSON"） | judgeRetry |
| `{{lastRaw}}` | 上次错误输出（截断） | judgeRetry |
| **其他** | | |
| `{{currentTime}}` | 当前时间 | judgeUser |

**渲染规则**：
- `{{x}}` → x 的值；无值 → 空字符串（prompt 里相应位置自动留空，不报错）
- 列表类（`{{judgeGaps}}`/`{{judgeEvidence}}`/`{{subgoalsBlock}}`）→ `- item1\n- item2` bullet 块
- 块类（`{{contractBlock}}`）→ 带标签的多行块（如 `- Outcome: ...\n- Verification: ...`）
- 未知占位符 → 原样保留 `{{unknownName}}`（方便发现拼写错误）

**示例**——自定义 continue 续行（solo）的末句，其余用默认：
```jsonc
{
  "prompts": {
    "continueSolo": "[goal 续行] 还没完。差距：\n{{judgeGaps}}\n\n接着干，别停。"
  }
}
```

## 已知限制

1. **裁判靠 LLM 判断证据**：无确定性验证（gates/contract 已废弃，详见 ADR-003）。裁判 prompt 硬性要求 tool result 级证据，实测保守，但理论上可被欺骗。
2. **wait 用 agent 估算秒数（非进程感知）**：pi 拿不到 agent 后台进程 pid。wait 续行 prompt 教 agent 报告预计剩余秒数，judge 提取后 park。
3. **裁判成本**：每轮空闲跑一次模型查询。建议配廉价模型 + token 预算兜底。
4. **solo 激进风险**：solo 模式 agent 更自主。缓解：预算限成本、/goal status 透明展示、/goal pause 随时暂停。

## 架构决策记录（ADR）

| ADR | 决策 | 状态 |
|---|---|---|
| [ADR-001](adr/001-trigger-agent-settled-not-stop-hook.md) | 触发用 `agent_settled` + 续行，非 Stop hook | Proposed |
| [ADR-002](adr/002-judge-route-not-agent-self-managed.md) | 判定走独立裁判，非 agent 自管理（Codex 路线） | Proposed |
| [ADR-003](adr/003-anti-self-praise-gates-and-contract.md) | 防自吹：裁判硬性要求证据（原 gates/contract 已废弃） | Superseded |
| [ADR-004](adr/004-budget-token-and-turn-dual-track.md) | 总量预算可选（默认不限）+ 信号预算硬默认 | Proposed |
| [ADR-005](adr/005-all-modes-no-interactive-gate.md) | 全模式启用，不照搬 Claude Code 交互/非交互 gate | Proposed |
| [ADR-006](adr/006-solo-attribute-and-judge-state-system.md) | solo 属性（默认 true）+ judge 4 态 + impossible 韧性 | Proposed |
