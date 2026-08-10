# AGENTS.md

本项目是 **pi coding agent** 的学习与定制工坊：通过 extensions / skills / tools 机制构建完全可控的 coding agent（从 Claude Code 迁移而来）。仓库本身是一个 **pi package**（`package.json` 带 `"pi"` 清单），可 `pi install` 安装，也可本地直接引用。

## 红线约束（每次改动都必须遵守）

1. **无构建步骤（针对 pi 加载的资源）**：pi 通过 jiti 直接加载**扩展 / skill / prompt / theme** 的 TypeScript，改完用 `/reload` 热加载，**不要**引入 tsc / webpack 等编译流程。**独立应用**（如 `web-console/`）不在此限——它不被 pi 加载，而是消费 pi SDK，按自身 ADR 决定（见 `web-console/docs/design/adr/001-allow-build-step.md`）。
2. **chrome-devtools-mcp 兼容性是硬约束**（见 ADR-002）：扩展的 52 个工具必须与 chrome-devtools-mcp 的工具名、参数、行为一一对应，不自创命名。
3. **CDP 客户端统一用 `chrome-remote-interface`**（见 ADR-001），不引入 puppeteer / playwright 等替代库。
4. **架构决策走 ADR 流程**：涉及范围 / 依赖 / 设计取舍的决策，先在 `extensions/chrome-devtools/docs/design/adr/` 记录，再实现。

## 目录结构

```
├── extensions/
│   └── chrome-devtools/      # 核心扩展：52 个 CDP 工具（兼容 chrome-devtools-mcp）
│       ├── index.ts          # 单文件入口
│       └── docs/design/      # 设计文档 + ADR
├── web-console/              # 独立 Node 应用：浏览器远程操作 pi（消费 pi SDK，允许构建，自带 docs/design/）
├── .agents/skills/           # 项目维护用 skill（开发本 repo 时按需加载）
├── skills/                   # 包对外发布的 skill（给安装本包的用户）
├── prompts/  themes/         # prompt 模板 / 自定义主题
├── docs/                     # 学习笔记
├── .pi/chrome-devtools.json  # 扩展配置 { "port": 19999 }
└── package.json              # pi package 清单
```

> `.agents/skills/` 与 `skills/` 区分：前者是**维护本项目自身**的 skill（开发时按需加载），后者是本包**对外发布**给用户的 skill。

## 技术栈

TypeScript（pi 直载，无编译） · chrome-remote-interface（CDP 通信） · pi `ExtensionAPI` · typebox

## 编码约定

- 文档、注释、commit message 用**中文**（与现有 README / ADR 一致）。
- 扩展以单文件 `index.ts` 为入口；CDP 相关一律走 chrome-remote-interface。
- 目前无测试框架与 lint 配置；保持 `index.ts` 内工具注册结构清晰、可检索。

## 关键文档

- chrome-devtools 扩展完整设计：`extensions/chrome-devtools/docs/design/design.md`（背景、架构图、UID 系统、配置、52 工具详表、已知限制）
- ADR 记录：`extensions/chrome-devtools/docs/design/adr/`

## 可用 Skills

两个开发类 skill 管的是**不同制品**，刻意分工、不冲突：

| Skill | 管什么 | 何时加载 |
|-------|--------|---------|
| `pi-extension-dev` | pi **扩展**的开发流程 + 扩展的 design.md / ADR | 开发 / 调试扩展、写扩展设计文档或 ADR 时 |
| `od-dev-writing-skills` | 怎么写好 **skill 内容**（4 条硬规范）+ skill 自身的 design/decisions | 创建 / 修改任何 skill、写 SKILL.md 时 |

> `od-dev-writing-skills` 是从 OneDragon-Skills 仓**手动复制的快照**（非活链接）；来源与同步方式见该 skill 的 `SOURCE.md`。

两者 ADR 格式不同、各管各的制品：扩展 ADR 走 `pi-extension-dev`（`extensions/<name>/docs/design/adr/`，TEMPLATE.md 格式）；skill 自身设计决策走 `od-dev-writing-skills`（`<skill>/design/decisions/`，arc42 §9 格式）。用 `/skill:<name>` 可手动加载。
