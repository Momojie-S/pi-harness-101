// 渲染单条消息（user / assistant / toolResult / system-error）
// read/edit/write 的文件路径可点击 → 打开文件查看器看完整内容
import { memo } from "react";
import type { ChatMessage } from "../types.ts";
import { LazyMarkdown as Markdown } from "./LazyMarkdown.tsx";

interface Props {
  message: ChatMessage;
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

// memo：message/onOpenFile/patches 引用不变时跳过重渲染。消息对象在 reducer 里保持引用稳定
//（message_end 用展开运算符 [...messages, new] 保留旧引用），onOpenFile 由 App useCallback 稳定，
// patches 仅 edit/write 工具结果时变。这是消除「540+ 条消息每次 reducer 更新都重新 markdown 解析」的关键。
export const MessageView = memo(function MessageView({ message, onOpenFile, patches }: Props) {
  // 系统错误消息：红色提示，按时间顺序在消息流中显示（和 TUI 一致）
  if (message.role === "system-error") {
    return (
      <div className="rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger">
        <span className="font-medium">✗ 错误</span>
        <p className="mt-1 whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    );
  }

  // 系统提示消息：成功/信息反馈（绿色，对称于 system-error），进消息流显示
  if (message.role === "system-notice") {
    return (
      <div className="rounded-lg border border-ok bg-ok-soft p-3 text-sm text-ok">
        <span className="font-medium">✓ {message.content}</span>
      </div>
    );
  }

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
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent px-4 py-2 text-sm text-accent-contrast">{text}</div>
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
      <div className="rounded-lg border bg-surface p-3 text-xs">
        <div className={`font-mono ${isError ? "text-danger" : "text-fg-tertiary"}`}>
          {isError ? "✗ " : "→ "} {message.toolName}
        </div>
        {isRead ? (
          <span className="text-fg-tertiary">（{text.length} 字符，点击上方 📄 路径查看完整内容）</span>
        ) : isEdit && patch ? (
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-fg-secondary">{patch}</pre>
        ) : isEdit ? (
          <span className="text-fg-tertiary">（已写入，点击上方 📄 路径查看）</span>
        ) : (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-fg-secondary">{text.slice(0, 800)}</pre>
        )}
      </div>
    );
  }

  // assistant 消息：渲染 content blocks
  return (
    <div className="max-w-[92%] space-y-2">
      {blocks.map((b: ContentBlock, i: number) => {
        if (b.type === "text") {
          return <Markdown key={i}>{b.text}</Markdown>;
        }
        if (b.type === "thinking") {
          return (
            <details key={i} className="rounded-md bg-surface px-3 py-2 text-xs text-fg-tertiary">
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
          <div key={i} className="rounded-md border bg-surface px-3 py-2 text-xs">
            <span className="font-mono text-accent">🔧 {b.name}</span>
            {isFileTool && filePath ? (
              <button
                onClick={() => onOpenFile(filePath)}
                className="mt-1 block max-w-full truncate text-left font-mono text-accent hover:underline"
                title={filePath}
              >
                📄 {filePath}
              </button>
            ) : (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-fg-tertiary">
                {typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
});
