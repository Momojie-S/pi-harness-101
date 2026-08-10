---
name: pi-extension-dev
description: 当要开发或调试 pi 扩展、给扩展写设计文档、做架构决策（写 ADR）时用。英文: develop/debug a pi extension, write extension design doc, write ADR。凡是给本 repo 新增/修改 extension、写扩展的 design.md 或 ADR 都用，即使没明说。仅管 pi 扩展这个制品；写 skill 内容用 od-dev-writing-skills。
---

# 开发 pi 扩展

本 repo 的 pi 扩展放在 `extensions/<name>/`，单文件 `index.ts` 为入口，pi 经 jiti 直接加载 TypeScript（无编译）。下面是开发、写设计文档、写 ADR 必须遵守的规范。

## 分工边界
本 skill 管 pi **扩展**（代码 + 扩展的 design.md + 扩展的 ADR）。写 **skill 内容**（SKILL.md 怎么写、skill 带哪些文件）用 `od-dev-writing-skills`。两者 ADR 格式不同、各管各的制品，不冲突（理由见本 skill `design/decisions/0001`）。

## 红线（每次改动都遵守）
1. **无构建步骤**：改完 `index.ts` 用 `/reload` 热加载，**禁止**引入 tsc / tsup / webpack 等编译流程。
2. **chrome-devtools-mcp 兼容**（仅 chrome-devtools 扩展）：工具名 / 参数 / 行为与 chrome-devtools-mcp 一一对应，不自创命名（见该扩展 ADR-002）。
3. **CDP 一律用 `chrome-remote-interface`**，不引入 puppeteer / playwright（见 chrome-devtools 扩展 ADR-001）。

## 开发流程
1. **本地引用**：在 `~/.pi/agent/settings.json` 的 `extensions` 数组加扩展绝对路径。
2. **改完即 `/reload`**，无需重启 pi。
3. **ExtensionAPI 核心接口**（框架地基级，直接用；parameters 用 typebox）：
   - `pi.registerTool({ name, label, description, parameters, execute })` — 注册工具
   - `pi.registerCommand(name, { handler })` — 注册 `/` 命令
   - `pi.on(event, handler)` — 订阅事件（`session_start` / `tool_call` / `model_select` 等）
   - `ctx.ui.setStatus(key, text)` / `ctx.ui.setWidget(key, lines)` — footer / 编辑器上方 UI
4. **验证**：`/reload` 后让 agent 调用相关工具；chrome-devtools 扩展需浏览器以 `--remote-debugging-port` 启动。

## 写扩展设计文档
动手实现复杂功能前，先在 `extensions/<name>/docs/design/design.md` 写设计文档。必备结构：
1. **背景** — 解决什么问题；含「为什么不用 X」的排除理由
2. **架构** — 结构图 + 核心机制
3. **配置** — 配置项、优先级、默认值
4. **功能 / 工具清单** — 逐项（名称 → 实现方式 → 状态）
5. **已知限制** — 做不到什么

> 本 repo 已有实例：chrome-devtools 扩展的 `design.md`（结构参考，不必逐字照搬）。

## 写 ADR（架构决策记录）
**何时写**：依赖选型、功能范围划定、核心机制取舍、对外兼容性承诺等**难逆 / 影响深远**的决策。调参 / 笔误 / 局部重构 → commit message 即可，不配 ADR。

**放哪**：`extensions/<name>/docs/design/adr/`，文件名 `NNN-kebab-case.md`，编号递增。

**格式**（必备段落）：
- 标题 `ADR-XXX: 简短描述`
- 状态 `Proposed` / `Accepted` / `Deprecated` / `Superseded by ADR-YYY`
- 背景 — 什么情况需要决策、问题是什么
- 决策 — 决定做什么
- 备选方案 — 对比表（方案 | 优点 | 缺点）
- 后果 — 正面 / 负面分开
- 参考 — 相关链接

> 本 repo 已有实例：chrome-devtools 扩展 `adr/TEMPLATE.md`（模板）+ ADR-001 / ADR-002。

**已定决策，勿重复**：
- ADR-001 用 `chrome-remote-interface`（排除 puppeteer / playwright / 原生 WebSocket）
- ADR-002 功能范围对齐 chrome-devtools-mcp

**新决策与已有 ADR 冲突时**：新建 ADR 并把旧 ADR 标 `Superseded by ADR-NNN`，不直接删。
