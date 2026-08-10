# ADR-0001: 与 od-dev-writing-skills 分工、ADR 格式分立

## Status

Accepted

## Context

本 repo 同时引入了两套开发方法论：

- `pi-extension-dev`（自建）—— pi 扩展开发流程，含扩展的 design.md + 扩展 ADR。扩展 ADR 已有既定格式（chrome-devtools 扩展的 `TEMPLATE.md`：标题 / 状态 / 背景 / 决策 / 备选方案 / 后果 / 参考），且 ADR-001 / ADR-002 已按此格式落地。
- `od-dev-writing-skills`（从 OneDragon-Skills 复制的快照）—— skill 内容写作方法论，规定每个 skill 自身要有 `design/decisions/`，ADR 用 arc42 §9 格式（Status / Context / Considered Options / Decision / Consequences）。

两者都涉及「设计文档」和「ADR」。若不明确分工，agent 会拿到矛盾指令：同一份 ADR 该用哪种格式、放哪个目录。

## Considered Options

| 方案 | 优点 | 缺点 |
|------|------|------|
| A. 合并为一个 skill | skill 数量少 | description 过泛导致触发不准；扩展开发与 skill 写作是不同任务，合并冲淡焦点 |
| B. 两者并存、按制品分工 | 触发精准；各管各的制品，自然不冲突 | 仓库里同时有两套 ADR 约定，需在多处写清边界防混淆 |
| C. 统一改用 arc42 §9（含迁移现有 ADR-001/002） | 全仓库一套 ADR 格式 | 要改造已落地的 chrome-devtools ADR-001/002；改造量大且收益小 |

## Decision

选 **B**：两者并存，按**制品**分工——

- `pi-extension-dev` 管「pi 扩展」制品：扩展 design.md + 扩展 ADR（TEMPLATE.md 格式，放 `extensions/<name>/docs/design/adr/`）。
- `od-dev-writing-skills` 管「skill」制品：skill 内容 + skill 自身设计决策（arc42 §9 格式，放 `<skill>/design/decisions/`）。

两者管的制品不同，ADR 格式各随其制品：扩展架构决策保留 TEMPLATE.md 现状（不迁移），skill 自身设计决策用 arc42（与 od-dev-writing-skills 一致）。

## Consequences

### 正面
- 触发精准：开发扩展触发 `pi-extension-dev`，写 skill 触发 `od-dev-writing-skills`。
- chrome-devtools 现有 ADR-001 / ADR-002 无需迁移格式。
- 各 skill 自身设计决策统一用 arc42（含本 skill 的 `design/decisions/`），与 od-dev-writing-skills 方法论一致。

### 负面
- 仓库里有两套 ADR 格式（扩展 vs skill），需在 `AGENTS.md` 与各 skill 写清边界，否则 agent 可能混淆。
- 新建 skill 时要同时遵循两套约定：skill **内容**按 od-dev-writing-skills，skill **挂载位置 / 命名**按本 repo 约定（`.agents/skills/`，见 repo AGENTS.md）。
