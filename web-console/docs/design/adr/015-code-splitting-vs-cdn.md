# ADR-015: 代码分割懒加载 Markdown chunk（而非 CDN）

## 状态

Accepted

## 背景

[ADR-014](014-code-syntax-highlight.md) 引入 highlight.js 后，前端 JS bundle gzip 从 107KB 涨到 164KB（+57KB，主要为 highlight.js 语法数据）。首屏（单 chunk）需全量加载这些语法数据，弱网（手机经 frp 隧道）体验差。遂提出「依赖包改用国内 CDN、不打包」以减小首屏体积。

## 面临的选择

| 方案 | 做法 |
|------|------|
| A. 国内 CDN（external + script / importmap） | react/react-dom 用 UMD CDN；highlight.js 等 ESM 包用 esm.sh + importmap |
| **B. 代码分割懒加载（React.lazy）** | 把 Markdown 组件（含 highlight.js）拆独立 chunk，首屏不加载，按需拉取 |
| C. 维持单 chunk | 不变 |

## 决策

**选 B（代码分割）。**

### 为什么不选 A（CDN）

1. **场景不匹配**：本工具是经 Basic Auth 认证的**私有工具**（`pi.momojie.online`），非公众站点。CDN 的核心收益（边缘缓存命中、跨地域加速）对低频单用户内部工具几乎为零。
2. **可靠性**：依赖外部 CDN = 多一个故障点（CDN 挂 / 被墙 / 换域名 → 白屏）。当前自托管资源全走同一条 frp 隧道，要么全通要么全不通，简单可预测。
3. **供应链安全（最严重）**：从第三方 CDN 执行 JS，CDN 被入侵 / 包被篡改 = 在信任工具里跑任意代码。**2024 年 bootcdn（国内常用）发生过供应链投毒**。不加 SRI 校验等于裸奔，加 SRI 每次升级依赖要重算 hash、对齐 CDN 版本，维护成本高。
4. **技术可行性受限**：bundle 大头 highlight.js 的 rehype-highlight / lowlight 是 **ESM-only**，无 UMD 全局构建，无法 `<script src>` CDN 化。能 CDN 的只有 react/react-dom（~40KB gzip），收益小却要付可靠性代价。ESM CDN（esm.sh）国内访问不稳，又是新的外部依赖。
5. **瓶颈判断**：加载瓶颈是 **frp 隧道带宽**（本机上传 + 云中转），不是 JS 体积。把 react 放 CDN，highlight.js 仍走隧道，治标不治本。

### 为什么选 B

- 纯本地、**零外部依赖**，不牺牲可靠性、不引入供应链风险。
- 首屏省 ~60KB+ gzip（react-markdown + highlight.js 全进 lazy chunk）。
- Vite 原生支持（动态 `import()` 自动分割），改动小。
- 二次访问两个 chunk 均被浏览器缓存（hash 文件名），秒开。

## 实现

新增 `LazyMarkdown` 组件（`src/components/LazyMarkdown.tsx`）：

- `React.lazy(() => import("./Markdown"))` 把 Markdown 组件及其依赖（react-markdown / remark-gfm / rehype-highlight / highlight.js / lowlight）拆到独立 chunk。
- `<Suspense>` 边界 + **纯文本 fallback**：chunk 加载期间用 `whitespace-pre-wrap` 显示原始文本（用户立刻看到内容，非空白），加载完替换为渲染版（含高亮）。
- 对外接口与 `Markdown` 一致（`children` + `variant`），三个使用点（MessageView / ChatPanel / FileViewer）用 `import { LazyMarkdown as Markdown }` 别名替换，**调用处零改动**。

Vite 构建产出两个 chunk：

- **主 chunk（首屏）**：react / react-dom / 业务骨架（App / hooks / reducer / wsClient / Sidebar / …）
- **lazy chunk**：Markdown 组件 + react-markdown + highlight.js 等，首次渲染含富文本 / 代码块的消息时按需加载。

## 后果

### 正面

- 首屏主 chunk gzip 显著下降（164KB → ~95KB 量级，实测见 build 输出）。
- 弱网首屏更快（不等语法数据）。
- 零外部依赖、零供应链风险。

### 负面

- 首次访问有极短的「纯文本 → 渲染」切换（chunk 加载延迟，本地 / 隧道通常 <100ms；缓存后无感）。
- 多一个网络请求（lazy chunk），但可被浏览器长期缓存。

## 参考

- [ADR-014](014-code-syntax-highlight.md)（highlight.js，本 ADR 优化其加载）
- [ADR-013](013-markdown-rendering.md)（Markdown 渲染）
