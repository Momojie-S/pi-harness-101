# Personal Context Extension

读取项目根的 `AGENTS.local.md`，注入为 system prompt 的「项目级个人本地」层。

## 为什么需要它

pi 原生的 context file 加载只有两层：

| 层级 | 文件 | 性质 |
|------|------|------|
| 全局 | `~/.pi/agent/AGENTS.md` | 个人，跨项目 |
| 项目共享 | `<cwd>/AGENTS.md` | **团队共享**（git 跟踪） |

缺少「项目级**个人**」这一层——某个项目里你的个人偏好（编码习惯、环境差异、个人备忘），不适合提交到团队共享的 `AGENTS.md`，但每次会话都需要。本扩展填补这个空白。

## 用法

1. 在项目根创建 `AGENTS.local.md`，写入你的个人配置。
2. 在 `.gitignore` 里加一行 `AGENTS.local.md`（确保不提交）。
3. 完成。扩展自动在每次 agent 运行前读取并注入。

```bash
echo "AGENTS.local.md" >> .gitignore
# 然后编辑 AGENTS.local.md
```

> 文件不存在或为空时静默跳过，零配置、零干扰。

## 三层配置全景

| 层级 | 文件 | 谁加载 | git |
|------|------|--------|-----|
| 全局个人 | `~/.pi/agent/AGENTS.md` | pi 原生 | — |
| 项目共享 | `<cwd>/AGENTS.md` | pi 原生 | ✅ 跟踪 |
| **项目个人** | `<cwd>/AGENTS.local.md` | **本扩展** | ❌ gitignore |

注入顺序：全局 → 项目共享 → 项目个人（后者追加在 systemPrompt 尾部，可覆盖/细化前者）。

## 设计文档

- [设计总览](docs/design/design.md)
- [ADR-001: 命名选 AGENTS.local.md 而非 .pi/AGENTS.md](docs/design/adr/001-agents-local-md-naming.md)
