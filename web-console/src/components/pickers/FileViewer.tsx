// 文件查看模态（重构 Step 4）。
// 按文件扩展名选择渲染策略（ADR-013 markdown + ADR-014 代码高亮）：
//   - markdown 类（.md/.markdown/.mdx）→ Markdown 组件渲染（标题/列表/表格 + 代码块高亮）；
//   - 代码文件（扩展名命中 LANG_MAP）→ 包成动态长度 fenced block 喂 Markdown，按语言高亮；
//   - 其余 → <pre><code> 纯文本（无对应语言，不着色）。
// 三者共用同一套 rehype-highlight + .hljs 主题 CSS（单一渲染管线，ADR-014）。
// 二进制/超大文件已在后端拦截（ADR-005），到这里的都是可读文本。
import { Modal } from "./Modal.tsx";
import { LazyMarkdown as Markdown } from "../LazyMarkdown.tsx";

interface FileViewerProps {
  fileViewer: { path: string; content: string } | null;
  pendingFile: string | null;
  onClose: () => void;
}

/** markdown 文件扩展名（小写） */
const MD_EXTS = new Set(["md", "markdown", "mdx"]);

/**
 * 扩展名 → highlight.js 语言（common 子集，ADR-014）。
 * key 取扩展名小写；无扩展名的特殊文件名（Dockerfile/Makefile）也收录。
 * 未列出的扩展名 → 视为纯文本，不着色。
 */
const LANG_MAP: Record<string, string> = {
  // JS / TS 系
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  // 数据 / 标记
  json: "json",
  yml: "yaml", yaml: "yaml",
  xml: "xml", svg: "xml",
  html: "xml", htm: "xml",
  // 样式
  css: "css", scss: "scss", less: "less",
  // 脚本 / Shell
  sh: "bash", bash: "bash", zsh: "bash", shell: "bash",
  ps1: "powershell", psm1: "powershell", psd1: "powershell", ps: "powershell",
  // 通用语言
  py: "python",
  go: "go", rs: "rust", java: "java", kt: "kotlin",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cxx: "cpp",
  cs: "csharp", rb: "ruby", php: "php", swift: "swift", sql: "sql",
  // 配置 / 构建
  ini: "ini", conf: "ini", toml: "ini", properties: "properties",
  diff: "diff", patch: "diff",
  dockerfile: "dockerfile", makefile: "makefile",
};

/** 取路径的「语言标识」：有扩展名取扩展名小写，无扩展名取文件名小写（Dockerfile 等） */
function langKeyOf(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return (dot < 0 ? base : base.slice(dot + 1)).toLowerCase();
}

/**
 * 构造足够长的 fenced code fence，保证内容里已有的反引号串不会破坏围栏（CommonMark 规范）。
 * 取内容中最长反引号串长度 +1，至少 3。
 */
function fenceFor(code: string): string {
  const runs = code.match(/`+/g);
  const max = runs ? Math.max(...runs.map((s) => s.length)) : 0;
  return "`".repeat(Math.max(3, max + 1));
}

export function FileViewer({ fileViewer, pendingFile, onClose }: FileViewerProps) {
  // fileViewer 可能在关闭动画中仍存在，渲染分支用空值兜底
  const path = fileViewer?.path ?? "";
  const content = fileViewer?.content ?? "";
  const key = langKeyOf(path);
  const isMd = MD_EXTS.has(key);
  const lang = LANG_MAP[key];
  // 正在加载（read_file pending）：点击文件后立即弹出 loading，内容到达后填充
  const isLoading = !!fileViewer && pendingFile === path;
  // 超大代码文件降级纯文本：rehype-highlight 对大文件是秒级 long task（词法分析），
  // 后端放行到 1MB，直接高亮会卡死查看器。>100KB 不高亮，避免主线程阻塞。
  const tooBig = content.length > 100_000;

  // 标题栏模式标签
  const modeLabel = isMd ? "Markdown" : (lang && !tooBig) ? lang : "纯文本";

  return (
    <Modal open={!!fileViewer} onClose={onClose} bodyClass="flex h-[80vh] w-full max-w-4xl flex-col rounded-lg border-strong bg-surface-elevated shadow-lg">
      {fileViewer && (
        <>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="truncate font-mono text-xs text-fg-secondary">{path}</span>
            <span className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wide text-fg-quaternary">{modeLabel}</span>
              <button onClick={onClose} className="text-fg-tertiary hover:text-fg">✕ 关闭</button>
            </span>
          </div>
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-fg-tertiary">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-fg-tertiary border-t-transparent" />
              加载中…
            </div>
          ) : isMd ? (
            // markdown 文件：直接渲染（内部代码块也会高亮）
            <div className="flex-1 overflow-auto px-5 py-4">
              <Markdown variant="block">{content}</Markdown>
            </div>
          ) : lang && !tooBig ? (
            // 代码文件：包成 fenced block，按语言高亮（>100KB 降级纯文本，见 tooBig）
            <div className="flex-1 overflow-auto px-5 py-4">
              <Markdown variant="block">{`${fenceFor(content)}${lang}\n${content}\n`}</Markdown>
            </div>
          ) : (
            // 纯文本（无对应语言）：等宽纯文本
            <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-fg"><code>{content}</code></pre>
          )}
        </>
      )}
    </Modal>
  );
}
