# personal-context 设计总览

## 1. 背景

### 问题
pi 原生的 context file 加载（`resource-loader.js` 的 `loadContextFileFromDir`）只有两层：
- **全局**：`~/.pi/agent/AGENTS.md`
- **项目共享**：`<cwd>/AGENTS.md` + 祖先目录的 `AGENTS.md`（团队共享，git 跟踪）

缺少「项目级**个人**」层。用户需要某个项目里的个人偏好（如 Windows 路径风格、个人备忘、环境差异），不适合放进团队共享的 `AGENTS.md`，但每次会话都需要。

### 调研结论（业界惯例）
调研了 Claude Code、Cursor、Copilot、Codex CLI、Windsurf、Aider、Cline、Gemini CLI 等主流 coding agent 后发现：
- **三级分层是事实标准**（全局 + 项目共享 + 项目本地）
- **「项目本地」是普遍短板**——只有 Claude Code 用 `CLAUDE.local.md` 做成了一等公民
- 其余工具大多没有明确的项目本地层

详见 ADR-001。

### 为什么不用其他方案
| 方案 | 排除理由 |
|------|---------|
| `.pi/AGENTS.md` | 自定义路径，非业界惯例；pi 永远不会原生支持；其他 agent 不认识 |
| 等 pi 原生支持 `.local` | 不可控的时间线；现在就需要 |
| 手动 `--append-system-prompt` | 每次启动要带参数，不可持久化 |

## 2. 架构

```
用户发消息
  │
  ▼
before_agent_start 事件
  │
  ├─ readFileSync(<cwd>/AGENTS.local.md)
  │   ├─ 不存在 / 空 → return（不修改 systemPrompt）
  │   └─ 有内容 → 追加到 systemPrompt 尾部
  │
  ▼
pi 用修改后的 systemPrompt 调用 LLM
```

**核心机制**：`before_agent_start` 是 pi 扩展事件，支持返回 `{ systemPrompt }` 修改当轮 system prompt。本扩展在该事件里读取本地文件，内容追加到 `event.systemPrompt` 尾部。

**每次都重新读文件**：用户可实时编辑 `AGENTS.local.md`，下次发消息即生效，无需 `/reload`。

## 3. 配置

无配置项。文件存在即生效，不存在即静默。

唯一约定：`AGENTS.local.md` 放项目根（`ctx.cwd`），用户自行 gitignore。

## 4. 注入顺序（三层叠加）

pi 构造 systemPrompt 时，context files（全局 + 项目共享）已按顺序拼好。本扩展在 `before_agent_start`（pi 构造完 systemPrompt 之后、发给 LLM 之前）追加项目个人层：

```
[pi 原生] 全局 AGENTS.md
[pi 原生] 项目共享 AGENTS.md
[本扩展] 项目个人 AGENTS.local.md  ← 追加在尾部
```

后者不覆盖前者，而是叠加补充（业界主流是 concat 非 override）。

## 5. 功能清单

| 功能 | 实现方式 | 状态 |
|------|---------|------|
| 读取 `AGENTS.local.md` | `before_agent_start` + `readFileSync` | ✅ |
| 注入 systemPrompt | 返回 `{ systemPrompt: event.systemPrompt + content }` | ✅ |
| 文件不存在静默 | try/catch → return | ✅ |
| 实时生效（免 reload） | 每次 before_agent_start 都重读文件 | ✅ |

## 6. 已知限制

- **仅项目根**：不扫描子目录或祖先目录的 `.local` 文件（与 pi 原生的 AGENTS.md 嵌套加载不同）。项目本地配置天然属于"当前项目"，无需嵌套。
- **不区分 cwd 切换**：如果用户在会话中切换 cwd（`/cd` 等），下次发消息会读新 cwd 的 `AGENTS.local.md`。这是期望行为。
- **未来 pi 原生支持时**：若 pi 原生加载 `AGENTS.local.md`，本扩展会导致内容注入两次。届时删除扩展即可，文件不用改（见 ADR-001 后果）。
