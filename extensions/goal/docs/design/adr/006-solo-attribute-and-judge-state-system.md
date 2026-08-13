# ADR-006: solo 属性（无人值守）与 judge 状态体系

## 状态

Proposed

## 背景

goal 主要用于无人值守场景（web-console 手机发任务），但也可能人在场（本地 TUI）。两种场景的核心差异：**是否鼓励 agent 停下来求助**。

现有各家方案的不足：

- **Claude Code / Hermes 的 impossible 立即放行停止**——有人场景合理（停下问人最省），但无人值守是净损失：impossible 多数是"此路不通"而非"目标不可达"，换个库/方法/假设可能就成了，立即停等于放弃。
- **judge 判定保守程度不随场景变**——但无人值守时误判代价不对称：误判 done（假完成）无人发现；误判 impossible（过早放弃）无人纠正。
- **judge 只读最后回复，难主动判断"该不该问人"**——但如设计讨论中所澄清，**judge 不需要判断这个**，只需判"目标达没达成"；需要人的情况由 agent 显式求助 + 连续 impossible cap 兜底。

## 决策

### 1. solo 属性（非全局模式）

- 默认 **`true`**（全局，含 TUI）——无人值守是更常见场景，统一默认减少认知负担；想要"人在场可求助"显式 `--no-solo`。
- 设置方式 C（创建时 + 事后切换，不丢进度）：`/goal --solo <条件>` / `/goal --no-solo <条件>` / `/goal solo on|off`。
- 事后切换**实时生效**：续行 prompt 和 judge 调用时实时读 goal 当前的 solo 值，不固化于创建时。

### 2. judge 4 状态体系

`status: done | continue | wait | impossible`，各自字段（完整规格见 design.md §3）。核心原则：

- **`continue` 是默认/兜底**——judge 拿不准时返回 continue（保守，宁可多做一轮）。
- **judge 只判"目标达没达成"**，不判"该不该问人"。

### 3. impossible 韧性处理（solo 核心）

- **solo**：impossible **不停止**。续行 prompt 带 judge 的 `reason`（此路为何不通），由 **agent 自己**寻找替代方向（judge 信息少不瞎指挥；agent 有完整上下文更靠谱），`impossibleStreak++`；连续 ≥ `soloImpossibleCap`（默认 **3**）→ 真 pause + 通知。
- **非 solo**：impossible 直接 pause 让人决策。
- 灵感：Codex 的 `blocked` 连续 3 次门槛（防 agent 轻易放弃），用在本裁判路线上。区别是本设计由独立裁判判定 impossible（不信任 agent 自述），Codex 靠 agent 自报。

### 4. done 对称收紧

- solo 模式 **done 更严**：judge prompt 额外要求"无人值守误判完成代价大，证据（tool result / gates 通过）不充分 → 判 continue"。
- 与 impossible 韧性**对称**：solo 两方向都更保守——对"未完成"不轻易放弃（impossible 韧性），对"完成"不轻易放行（done 收紧）。

### 5. wait 超时兜底

- solo 模式 wait 可能死等（等永不触发的 pid / 永不来的 CI），无人发现。
- 加 `maxWaitSeconds`（默认 600s）：wait 超时未恢复 → 自动转 continue（重新戳，因可能只是 pid 感知丢失）而非 pause。

### 6. agent 求助识别（横切）

- agent 在回复里**显式说"需要用户确认 / 我被阻塞"** → judge 识别，**不当 done**，按 solo 映射：
  - solo → 映射 `impossible`，续行鼓励 agent 用合理默认值自主推进（走连续 cap）。
  - 非 solo → 直接 pause 让人介入。

## 备选方案

| 决策点 | 采纳 | 备选 | 为什么不选备选 |
|---|---|---|---|
| 无人值守的载体 | **goal 属性 `solo`** | 全局模式开关 | 同会话交替场景（开会→回来盯）切换别扭；属性更灵活 |
| `solo` 命名 | `solo`（4 字母） | `unattended`/`autonomous`/`auto` | `unattended` 太长；`auto` 语义泛；`solo` 短且精准（单兵不等队友） |
| 默认值 | **全局 true（含 TUI）** | TUI 默认 false | 无人值守更常见；统一默认减认知负担 |
| impossible 处理 | solo 换方向 + 连续 3 次 cap | 立即停（Claude/Hermes）/ 无限换方向 | 立即停在无人场景净损失；无限换方向死循环；连续 cap 平衡 |
| judge 是否判"该问人" | **不判**（只判目标达成） | 让 judge 综合判断是否需人 | judge 只看最后回复难判需人；用 agent 显式求助 + 连续 cap 兜底更可控 |

## 后果

### 正面

- 无人值守场景下 agent 不轻易放弃（换方向）、不轻易谎报完成（done 收紧），自主性 + 可靠性同时提升。
- judge 职责单一（判目标达成），实现和 prompt 都更简单，不背"判断该不该问人"的复杂负担。
- solo 作为属性可事后切换、实时生效，适配"开会→回来盯"等交替场景。
- wait 超时兜底防 solo 死等。

### 负面

- solo 模式 agent 更激进（不求助、自主决策），可能做出用户不预期的选择（如自主选了一个实现方案）。缓解：contract 的 `stop_when` 字段可硬性约束"什么情况必须停"；预算可选限成本；`/goal status` 透明展示。
- `impossibleStreak` 计数 + solo/非 solo 分流 + wait 超时，状态管理比"impossible 立即停"复杂。
- impossible 不带 alternative 字段（judge 信息少易瞎指挥，换方向交给有完整上下文的 agent）。

## 参考

- Codex `blocked` 连续 3 turn 门槛：`.temp/third-party/codex/codex-rs/ext/goal/src/spec.rs`（`update_goal` description）
- Hermes `wait` 裁决：`.temp/third-party/hermes-agent/hermes_cli/goals.py`（`JUDGE_SYSTEM_PROMPT` 的 WAIT 分支）
- Claude Code impossible 立即放行：`docs/research/goal/claude-code.md` §4
- solo 默认 true 的场景判断：web-console（程序化但人能看）是 goal 最大价值场景
