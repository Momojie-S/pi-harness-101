# ADR-013: Markdown 渲染（react-markdown + remark-gfm）

## 状态

Accepted

## 背景

coding agent 的输出几乎全是 markdown：代码块（```）、标题（##）、列表、表格、行内代码（`code`）、粗体等。

当前前端用 `whitespace-pre-wrap` 纯文本渲染（`<p>{b.text}</p>`），markdown 语法符号原样显示（用户看到的是 `## 标题` 而不是大字标题，` ```js ` 而不是高亮代码块）。可读性很差。

## 面临的选择

| 方案 | 做法 |
|------|------|
| **A. react-markdown** | React 生态标准库，组件化渲染，支持 remark/rehype 插件生态 |
| B. markdown-it + dangerouslySetInnerHTML | 更快但需手动 sanitize，非 React 组件化 |
| C. 纯文本（维持现状） | 不渲染，原样显示语法符号 |

## 决策

**选 A（react-markdown + remark-gfm）。**

- `react-markdown`：解析 markdown → React 组件树，安全（不直接 innerHTML），可自定义每个元素的渲染组件
- `remark-gfm`：GitHub Flavored Markdown 插件，支持表格、删除线、任务列表、自动链接

### 为什么不用 markdown-it（B）

1. **安全性**：markdown-it 输出 HTML 字符串，需 `dangerouslySetInnerHTML` + 手动 sanitize（XSS 风险）。react-markdown 默认安全（只生成 React 元素）。
2. **组件化**：react-markdown 可对每个元素（`code`/`pre`/`table`/`a`…）自定义渲染组件，天然适配 React 主题系统。
3. **流式友好**：streamText 是逐步追加的，markdown 可能不完整（如 ``` 未闭合）。react-markdown 容错处理，不会崩溃。

### 暂不做代码语法高亮

`rehype-highlight`（highlight.js）可作为后续增强。当前优先把 markdown 结构（代码块、列表、表格、标题）正确渲染出来——这是可读性的主要瓶颈。代码块先用 `<pre><code>` 等宽 + 背景色 + 横向滚动，语法高亮后续叠加。

## 放弃了什么

- **更极致的代码高亮**：暂不引入 rehype-highlight，代码块无语法着色。后续可按需叠加（只需加一个 rehype 插件 + 一套高亮 CSS）。
- **markdown-it 的性能优势**：react-markdown 每次渲染都重新解析，对于超长文本有性能开销。实测 coding agent 的单条消息长度可接受；若日后出现性能问题，可加 `useMemo` 缓存或换方案。

## 后果

### 正面

- 标题、列表、表格、代码块、行内代码等正确渲染，可读性大幅提升。
- 代码块横向滚动（`overflow-x-auto`），不撑破布局。
- 亮/暗主题适配（通过 CSS 变量 / Tailwind class）。

### 负面

- **包体积增加**：react-markdown + remark-gfm 约增加 ~30-40KB（gzip ~12KB）。对 web-console（当前 JS ~57KB gzip）可接受。
- **流式渲染的闪烁**：streamText 逐步追加时，react-markdown 每次重新解析可能产生轻微闪烁。实测可接受；若明显，可对 streamText 做防抖。

## 渲染点

| 位置 | 说明 |
|------|------|
| `MessageView.tsx` assistant text block | 已完成的 assistant 消息 |
| `ChatPanel.tsx` streamText | 流式输出中的文本 |

封装为 `Markdown.tsx` 组件，两处复用。

## 参考

- 主题系统：[ADR-010](010-frontend-theme-system.md)
- 布局铁律（代码块 overflow-x-auto）：[modules/layout.md](../modules/layout.md)
