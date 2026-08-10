# SOURCE — 来源与维护说明

> 本文件是**人工添加的维护标注**，不是 skill 内容的一部分（不进智能体执行上下文）。SKILL.md 及其 design/、references/ 保持与上游一致。

## 来源

本 skill **手动复制自** OneDragon-Skills 仓库（快照副本，非活链接）：

| 项 | 值 |
|----|----|
| 源仓库 | `/d/code/workspace/OneDragon-Skills`（本地，无 remote） |
| 源路径 | `OneDragon-Skills/skills/od-dev-writing-skills/` |
| 复制日期 | 2026-08-10 |
| 上游 skill 名 | `od-dev-writing-skills` |

**源仓后续更新不会自动同步到这里。** 需要更新时手动重新复制（见下）。

## 同步方式

```bash
# 从源仓覆盖副本内容（SOURCE.md 不在上游，不会被覆盖，无需重建）
cp -r /d/code/workspace/OneDragon-Skills/skills/od-dev-writing-skills/{SKILL.md,design,references} \
      .agents/skills/od-dev-writing-skills/
```

复制后建议 `diff -r` 核对，再提交。

## 分工边界（避免与 pi-extension-dev 冲突）

本 repo 同时存在两个「开发类」skill，管的是**不同制品**，刻意分工：

| Skill | 管什么 | ADR 格式 / 位置 |
|-------|--------|----------------|
| **od-dev-writing-skills**（本 skill，上游快照） | 怎么写好 **skill 内容**（4 条硬规范）+ 每个 skill **自身的** `design/decisions/` | arc42 §9，`<skill>/design/decisions/NNNN-*.md` |
| **pi-extension-dev**（本 repo 自建） | pi **扩展**的开发流程 + 扩展的 design.md / ADR | TEMPLATE.md 格式，`extensions/<name>/docs/design/adr/` |

两者不冲突：前者管「skill 这个制品怎么写」，后者管「pi extension 这个制品怎么开发」。扩展的 ADR 走 `pi-extension-dev` 的格式；skill 自身的设计决策走 `od-dev-writing-skills` 的 arc42 格式。

## 为何不活链接

实测确认 Windows junction 提交 git 后会被解引用成静态副本（见本 repo 相关讨论 / OneDragon-Skills 仓无 remote 无法 submodule）。故采用手动快照 + 本 SOURCE.md 标注来源。
