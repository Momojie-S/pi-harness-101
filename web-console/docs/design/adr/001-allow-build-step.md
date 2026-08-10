# ADR-001: Web Console 允许构建步骤

## 状态

Accepted

## 背景

AGENTS.md 红线 1 要求"无构建步骤"：pi 通过 jiti 直接加载 TypeScript，改完代码用 `/reload` 热加载，不引入 tsc / webpack 等编译流程。

这条红线的**本意**是保证 pi 加载的资源（扩展 / skill / prompt / theme）能被 jiti 即时直载、`/reload` 立即生效。一旦引入构建步骤，`/reload` 会加载到过期产物，热加载失效。

Web Console 是一个**独立 Node 应用**：

- 它不被 pi 加载，而是反过来调用 pi 的 SDK（`createAgentSession`）
- 它有独立的进程、独立的 `package.json`、独立的 `node_modules`
- 要做一个"好用的、适应自己的前端"，需要现代前端工具链（React + Vite + Tailwind），构建步骤不可避免

因此需要明确：红线 1 是否适用于 Web Console？

## 决策

**Web Console 允许构建步骤。** 红线 1 的适用范围明确为"pi 通过 jiti 加载的资源（扩展 / skill / prompt / theme）"；独立应用（如 `web-console/`）按自身 ADR 决定，不在此限。

Web Console 采用的构建工具链：Vite（前端构建）+ TypeScript（前后端）+ Tailwind CSS（样式）。这些产物不会进入 pi 的加载链路，与扩展的 `/reload` 热加载完全隔离。

## 备选方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **允许构建（本决策）** | 能用现代前端框架与工具链，HMR、产物优化、组件化开发体验好 | 多一个构建步骤、依赖更多 |
| 无构建（tsx 直载 + 原生前端） | 与红线 1 字面一致、零配置 | 无法用 React/Vue 等框架的现代开发体验；前端只能写原生 HTML/JS，"好用的、适应自己的前端"几乎做不到 |

## 后果

### 正面

- Web Console 可以自由选择现代前端技术栈（React + Vite + Tailwind）
- 红线 1 依然有效（对扩展 / skill / prompt / theme），未被破坏，只是适用范围被精确化
- 文档体系隔离清晰：扩展走无构建，独立应用按自身 ADR

### 负面

- 项目里多了一种"有构建步骤"的制品，新人需要理解红线 1 的适用边界
- Web Console 有自己的构建产物（`dist/`），需在 `.gitignore` 忽略（根 `.gitignore` 已有 `dist/`）

## 参考

- [AGENTS.md 红线 1](../../../../AGENTS.md)（无构建步骤）
- [design.md - 为什么允许构建](../design.md#为什么允许构建关键例外)
