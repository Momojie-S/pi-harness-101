// Markdown 的懒加载包装（ADR-015）。
// React.lazy 把 Markdown 组件（及其依赖 react-markdown / remark-gfm / rehype-highlight /
// highlight.js / lowlight）拆到独立 chunk，首屏主 chunk 不含这些语法数据；
// 只在首次渲染含富文本 / 代码块的消息时按需拉取。
//
// 加载期间用纯文本作 Suspense fallback（用户立刻看到内容，非空白）；
// chunk 加载完（及浏览器缓存后）即正常渲染（含高亮）。
//
// 对外接口与 Markdown 一致，使用点用 `import { LazyMarkdown as Markdown }` 别名替换即可零改动。
import { lazy, Suspense } from "react";

// Markdown.tsx 是 named export，React.lazy 需要 default → 用 .then 适配
const Markdown = lazy(() => import("./Markdown.tsx").then((m) => ({ default: m.Markdown })));

interface Props {
  children: string;
  variant?: "inline" | "block";
}

/** 加载中 fallback：纯文本预览（保留换行，避免空白闪烁） */
function Fallback({ children }: { children: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{children}</div>
  );
}

export function LazyMarkdown({ children, variant }: Props) {
  return (
    <Suspense fallback={<Fallback>{children}</Fallback>}>
      <Markdown variant={variant}>{children}</Markdown>
    </Suspense>
  );
}
