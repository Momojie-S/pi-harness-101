// Markdown 渲染组件：react-markdown + remark-gfm（GFM 表格/删除线/任务列表）
//  + rehype-highlight（代码块语法高亮，ADR-014）。
// 封装统一的元素样式（代码块横向滚动、表格滚动、行内代码高亮等），供
// MessageView / ChatPanel（variant="inline"）与 FileViewer（variant="block"）复用。
// 设计依据：ADR-013（markdown 渲染）、ADR-014（代码高亮）。
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// rehype-highlight 默认只注册 highlight.js common 子集（~37 语言），
// 不含 powershell / dockerfile——而本工具部署在 Windows、大量处理 PowerShell / 容器脚本，
// 故在 common 基础上补注册这两个语言（ADR-014）。每语言 grammar gzip ~3-5KB，可接受。
import { common } from "lowlight";
import powershell from "highlight.js/lib/languages/powershell";
import dockerfile from "highlight.js/lib/languages/dockerfile";

/** rehype-highlight 配置：common 子集 + powershell + dockerfile */
const highlightLanguages = { ...common, powershell, dockerfile };

interface Props {
  children: string;
  /**
   * 代码块（pre）样式变体：
   * - "inline"（默认，聊天消息）：max-h-80 限高 + 内部滚动 + 圆角边框背景。
   * - "block"（文件查看器）：不限高、无边框背景，由外层容器统一滚动。
   */
  variant?: "inline" | "block";
}

export function Markdown({ children, variant = "inline" }: Props) {
  // block 变体：去掉限高/边框/内边距，让代码铺满文件查看器，滚动交给外层。
  const preClass =
    variant === "block"
      ? "my-0 text-xs"
      : "my-2 max-h-80 overflow-auto rounded-lg border bg-surface p-3 text-xs";
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { languages: highlightLanguages }]]}
        components={{
          // 标题
          h1: ({ children }) => <h1 className="mt-4 mb-2 text-lg font-bold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 mb-2 text-base font-bold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-bold">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold">{children}</h4>,
          // 段落
          p: ({ children }) => <p className="my-2">{children}</p>,
          // 列表
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          // 行内代码 / 代码块内容
          // 注意：rehype-highlight 会给 code 加 hljs class，可能排在 language-xxx 前面，
          // 故用 includes 判断是否为代码块（fenced code），而非 startsWith。
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              // 透传 className（含 hljs + language-xxx），让 rehype-highlight 的 token span 生效
              return <code className={`font-mono text-xs ${className ?? ""}`}>{children}</code>;
            }
            return <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-accent">{children}</code>;
          },
          // 代码块容器：inline 变体横+纵向滚动（移动端 max-h-80）；block 变体不限高
          pre: ({ children }) => <pre className={preClass}>{children}</pre>,
          // 引用
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-fg-quaternary pl-3 text-fg-secondary">{children}</blockquote>
          ),
          // 表格：横向滚动
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b">{children}</thead>,
          th: ({ children }) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-t px-2 py-1">{children}</td>,
          // 分隔线
          hr: () => <hr className="my-3 border-t border-fg-quaternary" />,
          // 链接：新标签打开
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:opacity-80">{children}</a>
          ),
          // 粗体/斜体
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          // 任务列表 checkbox（GFM）
          input: ({ checked }) => (
            <span className="inline-block h-3.5 w-3.5 rounded border border-fg-tertiary align-middle">{checked ? "✓" : ""}</span>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
