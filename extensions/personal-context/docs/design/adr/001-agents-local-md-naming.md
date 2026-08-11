# ADR-001: 命名选 AGENTS.local.md 而非 .pi/AGENTS.md

## 状态

Accepted

## 背景

本扩展要填补 pi 的「项目级个人本地」context 层。需要决定个人本地配置文件的**路径与命名**。

初始提案：`.pi/AGENTS.md`（项目根的 `.pi/` 目录下）。

## 决策

采用 **`AGENTS.local.md`**（项目根，与 `AGENTS.md` 同级），而非 `.pi/AGENTS.md`。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **`AGENTS.local.md`**（选定） | 对齐 Claude Code 业界标准（`CLAUDE.local.md`）；`.local` 语义一目了然；AGENTS.md 生态可能识别；**未来 pi 原生支持 `.local` 时，扩展可删、文件不动** | 需在 `.gitignore` 加一行（极小成本） |
| `.pi/AGENTS.md` | 符合 pi 命名空间整洁感；`.pi/` 已有其他配置 | 自定义路径，非业界惯例；pi 永远不会原生支持（不在 `loadContextFileFromDir` 候选列表）；其他 agent 不认识 |
| `AGENTS.override.md` | pi 候选列表里已有此名（但语义是"覆盖"非"本地"） | pi 已将 `.override` 定义为"最高优先级覆盖"，语义冲突 |

## 调研依据

调研了 8 个主流 coding agent 的分层机制：
- **只有 Claude Code** 把项目本地做成一等公民（`CLAUDE.local.md`，明确文档 + gitignore 约定）。
- 其余工具（Cursor、Copilot、Codex、Windsurf、Cline 等）均无明确的项目本地层。
- `AGENTS.md` 是 OpenAI 推动的跨工具标准，与 `CLAUDE.md` 同构。
- `.local` 后缀是业界表达"本地个人、不入 git"的通用约定（vs `.override` = 覆盖优先级）。

## 后果

### 正面
- **语义清晰**：`.local` = 本地个人，与 `AGENTS.md`（共享）形成直观配对。
- **业界对齐**：熟悉 Claude Code 的用户零学习成本。
- **前向兼容**：若 pi 未来原生加载 `AGENTS.local.md`（加入 `loadContextFileFromDir` 候选列表），用户只需删除本扩展，文件和内容无需改动——平滑迁移。

### 负面
- **重复注入风险**：若 pi 原生支持后用户未及时删除扩展，`AGENTS.local.md` 内容会被注入两次（pi 原生一次 + 扩展一次）。缓解：扩展可在 `/reload` 或 `session_start` 时检测 pi 是否已加载该文件（`event.systemPromptOptions.contextFiles`），若已加载则跳过。当前暂不实现此检测，因为 pi 尚未原生支持。

## 参考

- pi context file 加载源码：`resource-loader.js` → `loadContextFileFromDir`，候选列表 `["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]`
- Claude Code 文档：`CLAUDE.md` + `CLAUDE.local.md` 分层
- 业界调研：见 design.md §1
