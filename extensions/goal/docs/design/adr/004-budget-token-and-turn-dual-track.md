# ADR-004: 预算用 token 主 + turn 兜底双轨

## 状态

Proposed

## 背景

完成驱动循环必须有预算上限防死循环（goal 永不达成时不能无限烧钱）。三家做法：

- **Codex**：token + 时间双预算，每 turn 结束核算 `account_thread_goal_usage(time_delta, token_delta)`，超限转 `BudgetLimited` 态。
- **Claude Code**：连续阻止 > 8 次（`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`，默认 8）强制结束。
- **Hermes**：turn 预算（默认 20）+ 裁判连续解析失败 cap（3）+ 连续传输失败 cap（5），多层。

turn 预算的问题：一个 turn 的 token 消耗从 2k 到 200k 不等，"20 turn" 可能是 40k 也可能是 4M token，成本不可控。token 预算精确，但 pi 的 token 统计可能不准（不同 provider 计费口径、流式累计误差）。

## 决策

**总量预算与信号预算职责分离**：总量预算（token/turn）是用户可选的成本控制，**默认都不限（`null`）**；信号预算（连续撞墙/连续失败）是系统硬默认的防死循环。

- `tokenBudget`（可选，默认 `null`=不限）：goal 每轮 input+output token 累计，超限 → pause。关心成本时显式设。
- `maxTurns`（可选，默认 `null`=不限）：turn 计数，超限 → pause。想限轮数时显式设。
- **信号预算（硬默认，不可关）**：
  - `soloImpossibleCap` = 3：连续 impossible ≥ 3 → pause（solo 模式专属，见 ADR-006）
  - 连续裁判解析失败 ≥ 3 → pause（防小模型不守 JSON 契约）
  - 连续裁判传输失败 ≥ 5 → pause（防坏 API key 烬预算）

默认行为：goal 一直跑到“真达成 / 真 impossible（连续 3 次）/ 裁判坏了 / 用户 clear”为止——纯粹的“做到完为止”语义。预算耗尽是 **pause（可 resume）**，不是 failed——用户可 `/goal resume`（重置计数）继续。

> **为什么总量预算默认不限而信号预算硬默认**：总量（token/turn）是“用户愿花多少”的主观选择，系统不该替用户定；信号（连续撞墙/裁判坏）是客观的死循环征兆，必须默认防护。

## 备选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| **总量可选（token+turn 都默认不限）+ 信号硬默认**（采纳） | 默认“做到完为止”符合语义；关心成本时可精确控制；信号层防死循环 | 用户同时设两个总量预算时双计数稍复杂 |
| 纯 turn（Hermes/Claude） | 实现简单 | 单 turn token 跨度大（2k~200k），"20 turn" 成本不可控 |
| 纯 token（Codex） | 精确 | pi token 统计可能不准（provider 口径差异、流式累计误差），无兜底时统计偏差导致预算失效 |
| 纯时间 | 直观（"跑 10 分钟"） | 任务 token 密度差异大，时间与价值/成本不成正比；pi 难精确计时单 goal |

## 后果

### 正面

- token 预算让用户能精确控制"这个 goal 最多花多少钱"，对 web-console（手机发任务）场景尤其重要。
- turn 兜底防 token 统计 bug 导致预算形同虚设。
- 多层失败 cap 防裁判模型不可用时静默烧预算（Hermes 实战教训）。
- pause 而非 failed：长任务可分段推进（resume 重置计数）。

### 负面

- token 统计依赖 pi 的 usage 上报（`turn_end` 的 usage / `message_end` 的 cost）。需确认 pi 在 `agent_settled` 时能拿到累计 token；若拿不到，退化为纯 turn（兜底生效）。
- 双计数 + 多层 cap 实现复杂度高于单一预算。

## 参考

- Codex token+时间预算：`.temp/third-party/codex/codex-rs/ext/goal/src/accounting.rs`（`account_thread_goal_usage`）+ `runtime.rs`（`BudgetLimited`/`UsageLimited` 态）
- Hermes 多层 cap：`.temp/third-party/hermes-agent/hermes_cli/goals.py`（`DEFAULT_MAX_TURNS=20` / `DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES=3` / `DEFAULT_MAX_CONSECUTIVE_TRANSPORT_FAILURES=5`）
- Claude Code block cap：`docs/research/goal/claude-code.md` §5（`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` 默认 8）
