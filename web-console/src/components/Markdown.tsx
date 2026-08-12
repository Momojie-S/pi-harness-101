// Markdown 渲染组件：react-markdown + remark-gfm（GFM 表格/删除线/任务列表）。
// 封装统一的元素样式（代码块横向滚动、表格滚动、行内代码高亮等），供 MessageView / streamText 复用。
// 设计依据：ADR-013。
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  children: string;
}

export function Markdown({ children }: Props) {
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          // 行内代码
          code: ({ children, className }) => {
            // 多行代码块（react-markdown 给 code 加 language-xxx class 时，它在 pre 内）
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return <code className={`font-mono text-xs ${className ?? ""}`}>{children}</code>;
            }
            return <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-accent">{children}</code>;
          },
          // 代码块容器：横向滚动，不撑破布局
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg border bg-surface p-3 text-xs">{children}</pre>
          ),
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
