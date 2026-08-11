// 渲染单条 AgentMessage（user / assistant / toolResult）
// read/edit/write 的文件路径可点击 → 打开文件查看器看完整内容
import type { AgentMessage } from "../types.ts";

interface Props {
  message: AgentMessage;
  onOpenFile: (path: string) => void;
  patches: Record<string, string>;
}

interface TextBlock { type: "text"; text: string }
interface ThinkingBlock { type: "thinking"; thinking: string }
interface ToolCallBlock { type: "toolCall"; name: string; arguments: string | object }
type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;

function safeParse(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return (v as Record<string, unknown>) ?? {};
}

function toBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return (Array.isArray(content) ? content : []) as ContentBlock[];
}

export function MessageView({ message, onOpenFile, patches }: Props) {
  // AgentMessage 是宽联合（user/assistant/toolResult 有 content；bashExecution/custom 形状不同）。
  // 这里只渲染有 content 的三类；其余跳过。
  if (!("content" in message)) return null;
  const role = message.role;
  const content = message.content;
  const blocks = toBlocks(content);

  // 用户消息：右对齐气泡
  if (role === "user") {
    const text = typeof content === "string" ? content : blocks.map((b) => "text" in b ? b.text : "").join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm">{text}</div>
      </div>
    );
  }

  // 工具结果：read 不显示内容（点路径看完整），其他截断显示
  if (role === "toolResult") {
    const isError = message.isError;
    const isRead = message.toolName === "read";
    const isEdit = message.toolName === "edit" || message.toolName === "write";
    const patch = isEdit ? patches[message.toolCallId] : undefined;
    const text = blocks.map((b) => "text" in b ? b.text : "").join("\n");
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
        <div className={`font-mono ${isError ? "text-red-400" : "text-slate-400"}`}>
          {isError ? "✗ " : "→ "} {message.toolName}
        </div>
        {isRead ? (
          <span className="text-slate-500">（{text.length} 字符，点击上方 📄 路径查看完整内容）</span>
        ) : isEdit && patch ? (
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-slate-300">{patch}</pre>
        ) : isEdit ? (
          <span className="text-slate-500">（已写入，点击上方 📄 路径查看）</span>
        ) : (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-slate-300">{text.slice(0, 800)}</pre>
        )}
      </div>
    );
  }

  // assistant 消息：渲染 content blocks
  return (
    <div className="max-w-[92%] space-y-2">
      {blocks.map((b: ContentBlock, i: number) => {
        if (b.type === "text") {
          return <p key={i} className="whitespace-pre-wrap break-words text-sm leading-relaxed">{b.text}</p>;
        }
        if (b.type === "thinking") {
          return (
            <details key={i} className="rounded-md bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
              <summary className="cursor-pointer select-none">思考过程</summary>
              <pre className="mt-2 whitespace-pre-wrap">{b.thinking}</pre>
            </details>
          );
        }
        // toolCall
        const args = safeParse(b.arguments);
        const filePath = args.path as string | undefined;
        const isFileTool = ["read", "edit", "write"].includes(b.name);
        return (
          <div key={i} className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs">
            <span className="font-mono text-amber-400">🔧 {b.name}</span>
            {isFileTool && filePath ? (
              <button
                onClick={() => onOpenFile(filePath)}
                className="mt-1 block max-w-full truncate text-left font-mono text-blue-400 hover:underline"
                title={filePath}
              >
                📄 {filePath}
              </button>
            ) : (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-slate-400">
                {typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
