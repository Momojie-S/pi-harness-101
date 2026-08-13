# ADR-014: 代码语法高亮（rehype-highlight）

## 状态

Accepted

## 背景

[ADR-013](013-markdown-rendering.md) 引入 react-markdown + remark-gfm 渲染 markdown 结构，明确把「代码语法高亮」列为后续增强（原文：「暂不引入 rehype-highlight，代码块先用 `<pre><code>` 等宽 + 背景色」）。当前两处代码展示均无着色，可读性差：

1. **聊天消息里的代码块**（`MessageView` / `ChatPanel` 经 `Markdown` 组件）
2. **FileViewer 打开代码文件**（`.ts`/`.js`/`.json`/…，`<pre><code>` 纯文本）

无着色时关键字 / 字符串 / 注释 / 数字难以区分，长代码块尤其难读。

## 面临的选择

| 方案 | 做法 |
|------|------|
| **A. rehype-highlight**（highlight.js via rehype） | rehype 插件，接入 react-markdown 管线；自动按 `language-xxx` 着色，输出 `.hljs-*` token class，配一套主题 CSS |
| B. react-syntax-highlighter（Prism / highlight.js 组件） | 独立 React 组件，每个代码块单独渲染；功能强（行号、语言选择器）但体积大、与 Markdown 的 `pre` 渲染割裂 |
| C. shiki（VS Code TextMate 语法） | 效果最好（VS Code 级配色），但体积大、需异步加载语言 grammar、流式 / 重建开销大 |

## 决策

**选 A（rehype-highlight）。**

1. **与现有架构天然契合**：ADR-013 已用 react-markdown，rehype-highlight 是 rehype 插件，`rehypePlugins={[rehypeHighlight]}` 一行接入，markdown 代码块立即着色，无需重构。
2. **体积可控**：highlight.js common 子集（~37 种常用语言）+ rehype-highlight，实测 gzip +~55KB（web-console JS gzip 107KB → 162KB）。对内部工具（远程操作 pi，首屏加载一次后缓存）可接受；若日后需瘦身，可改为按需注册语言或动态 import（见「负面」）。
3. **单一渲染管线**：聊天代码块、md 文件内代码块、FileViewer 代码文件，三者共用同一个 `Markdown` 组件 + rehype-highlight + 一套 `.hljs` 主题 CSS，避免多套高亮路径（详见「实现」）。

### 为什么不用 B（react-syntax-highlighter）

- 与 react-markdown 的 `pre`/`code` 自定义渲染**割裂**：要么接管整个 `pre`（失去 Markdown 组件统一的代码块样式 / 滚动），要么双轨。违背「单一渲染管线」。
- 体积更大（Prism + 语言包），行号 / 语言选择器等高级功能 web-console 当前不需要（YAGNI）。

### 为什么不用 C（shiki）

- 体积大、需异步加载语言 grammar、构建配置复杂。
- 流式输出（streamText）下每次重新高亮开销大；shiki 偏重一次性渲染。
- 收益（VS Code 级配色）对轻量预览场景 overkill。

## 实现

### Markdown 组件加 `variant`

`Markdown` 组件新增 `variant?: "inline" | "block"`（默认 `inline`），控制代码块（`pre`）样式：

- **inline**（聊天消息）：`max-h-80` 限高 + 内部滚动 + 圆角边框背景（沿用 ADR-013）。
- **block**（文件查看器）：不限高、无额外边框背景，由 FileViewer 外层 `flex-1 overflow-auto` 统一滚动。

加 `rehypePlugins={[rehypeHighlight]}`，代码块自动着色。

### 语言集（common + 补充）

rehype-highlight 默认注册 highlight.js common 子集（~37 种：typescript/javascript/python/bash/json/css/xml/yaml/go/rust/…）。**不含 powershell / dockerfile**——而本工具部署在 Windows、大量处理 PowerShell / 容器脚本，故在 common 基础上补注册这两个语言（`{ ...common, powershell, dockerfile }`，每语言 grammar gzip ~3-5KB）。实测：当前会话 13 个 PowerShell 代码块中 12 个正确着色（`hljs-comment`/`hljs-number`/`hljs-variable`/`hljs-built_in`/`hljs-literal`/`hljs-string`）。其余 common 集外的罕见语言（`.erl`/`.hs`/…）仍降级为纯文本，不报错。

### FileViewer 三分支

| 文件类型 | 渲染 | 说明 |
|----------|------|------|
| `.md`/`.markdown`/`.mdx` | `<Markdown variant="block">` | 复用 ADR-013，标题 / 列表 / 表格 + 代码块高亮 |
| 代码文件（扩展名命中映射表） | 包成动态长度 fenced block → `<Markdown variant="block">` | 复用同一管线，语言从扩展名映射（`.ts`→typescript …） |
| 其余（`.txt`/`.log`/未知） | `<pre><code>` 纯文本 | 无对应语言，不着色 |

**动态 fence**：取内容里最长反引号串长度 +1（≥3），保证含 ` ``` ` 的代码也能正确包裹（CommonMark fence 规范）。

### 主题 CSS

highlight.js 输出 `.hljs-*` token class（`hljs-keyword` / `hljs-string` / `hljs-comment` / `hljs-number` / `hljs-title` / …）。在 `index.css` 用 `[data-theme="dark"]` / `[data-theme="light"]` 各配一套 token 颜色（GitHub 风格，与 GitHub 代码块观感一致）。**不用 Tailwind darkMode**（主题由 CSS 变量驱动，见 [ADR-010](010-frontend-theme-system.md)）。

## 放弃了什么

- **VS Code 级配色（shiki）**：rehype-highlight 用正则 grammar，复杂语法（如 JSX 深度嵌套、模板字符串插值）偶尔不如 shiki 精准。对预览场景可接受。
- **行号、语言选择器、复制按钮**等代码块增强：暂不做（YAGNI），后续按需。
- **highlight.js 全语言**：只装 common 子集 + powershell/dockerfile 补充，罕见语言（如 `.erl`/`.hs`）降级为纯文本，不报错。

## 后果

### 正面

- 聊天代码块 + 文件查看器代码文件自动语法着色，可读性大幅提升。
- 单一高亮管线（rehype-highlight + 一套主题 CSS），维护成本低。
- 亮 / 暗主题各一套 token 色，随 `data-theme` 切换。

### 负面

- **包体积 +~55KB gzip**（highlight.js common 全量语法 + rehype-highlight；CSS 仅 +~0.55KB gzip）。对内部工具可接受。若需瘦身：用 `lowlight` 自建仅注册所需语言（可压到 +~15KB），或对 FileViewer 代码视图 `import("rehype-highlight")` 动态加载。
- 罕见语言不高亮（降级纯文本），需用户知晓。

## 参考

- [ADR-013](013-markdown-rendering.md)（Markdown 渲染，本 ADR 是其「后续增强」的落地）
- [ADR-010](010-frontend-theme-system.md)（主题系统，`data-theme` 驱动）
- [ADR-005](005-file-preview-safety.md)（文件预览安全，二进制 / 大文件拦截）
