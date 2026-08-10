# pi-extension-dev — 设计概览

> 本文件是给**后续维护者**的设计存档，不进智能体执行上下文。使用信息全在 `SKILL.md`。

## 定位
本 skill 是本 repo 中**开发 pi 扩展**的作者工作流指南：编码 → 设计文档 → ADR。属于项目内 dev skill（放 `.agents/skills/`，随项目走、不独立发布）。

## 边界
- **管**：pi 扩展（代码）的开发流程 + 扩展的 design.md + 扩展的 ADR。
- **不管**：skill 内容怎么写（归 `od-dev-writing-skills`）；skill 自身的设计决策（归各 skill 自己的 `design/decisions/`）。
- 两者都涉及「ADR」，但**格式与归属不同**：扩展 ADR 用 TEMPLATE.md 格式（`extensions/<name>/docs/design/adr/`）；skill 自身设计 ADR 用 arc42 §9 格式（`<skill>/design/decisions/`）。详见 `decisions/0001`。

## 构成
- `SKILL.md` — 给 agent 执行的指令（红线 + 开发流程 + 设计文档结构 + ADR 规范）
- `design/` — 本 skill 自身的设计记录（给维护者）
  - `overview.md`（本文件）：定位 / 边界 / 构成
  - `decisions/`：ADR，arc42 §9 格式
