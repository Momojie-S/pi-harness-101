# ADR-002: 判定走独立裁判，非 agent 自管理

## 状态

Proposed

## 背景

调研发现 Ralph loop 家族存在**两条对立路线**：

- **agent 自管理（Codex，源头）**：goal 是暴露给 agent 的工具（`create_goal`/`update_goal`），**agent 自己调 `update_goal(status=complete)` 声明完成**，没有独立裁判。防"谎报完成"全靠工具 description 里的 prompt 约束（"Do not mark complete merely because budget nearly exhausted"）+ `blocked` 门槛（同一阻塞连续 3 turn 才许标）。
- **独立裁判（Claude Code / Hermes）**：用户设条件，agent 停下时**另跑一个独立模型**读回复判条件是否达成，不信任 agent 自述。

本项目（pi-harness-101）的明确诉求是**对抗 agent 自吹**（见设计讨论：用户担心 assistant 在对话里说"我做完了/测试过了"误导判定）。

## 决策

走**独立裁判路线**：goal 条件由用户设置，agent 停下时由独立的 `modelRegistry.complete` 调用判定，不信任 agent 自述完成。

## 备选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| **独立裁判**（采纳） | 不信任 agent 自述，可对抗自吹；判定可客观化（配合 gates，见 ADR-003）；保守默认（缺证据=未完成） | 每轮额外一次模型调用（成本）；裁判可能误判 |
| agent 自管理（Codex 路线） | 无裁判成本；轻量；agent 能动性强 | **信任 agent 自述**——agent 可自吹说完成，机制上拦不住（只有 prompt 软约束）；与本项目"对抗自吹"诉求冲突 |
| 双轨（裁判 + 允许 agent 自报加速） | agent 自信完成时可快速结束省一次裁判 | 复杂度高；agent 自报仍需裁判复核（否则等于自管理）；收益小 |

## 后果

### 正面

- 直接满足"对抗自吹"诉求：完成判定权不在 agent 手里。
- 可叠加 gates（ADR-003）做到"确定性验证"，agent 自吹在 `npm test` 退出码面前失效。
- 保守默认（缺证据 → continue）偏向"宁可多做一轮"，符合"做到为止"语义。

### 负面

- 每轮空闲一次额外模型调用。缓解：配廉价裁判模型 + token 预算（ADR-004）。
- 裁判误判风险（假阳性/假阴性）。缓解：turn 预算兜底 + pause/resume 让用户介入；裁判 system prompt 刻意保守使假阳性（误判完成）少于假阴性。

## 参考

- Codex agent 自管理：`.temp/third-party/codex/codex-rs/ext/goal/src/spec.rs`（`create_goal`/`update_goal` 工具）+ `update_goal` description 的 prompt 约束
- Claude Code 独立裁判：`docs/research/goal/claude-code.md` §3
- Hermes 独立裁判：`.temp/third-party/hermes-agent/hermes_cli/goals.py` `judge_goal()` + `auxiliary_client`
- 生态对比：`docs/research/oss-comparison.md`（6/6 OSS 框架靠 agent 自报，独立裁判是少数派——本设计选择少数派是有意为之）
