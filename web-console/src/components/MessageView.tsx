// 渲染单条 AgentMessage（user / assistant / toolResult）
// read/edit/write 的文件路径可点击 → 打开文件查看器看完整内容
interface Props {
  message: any;
  onOpenFile: (path: string) => void;
  patches: Record<string, string>;
}

function safeParse(v: unknown): any {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v;
}

export function MessageView({ message, onOpenFile, patches }: Props) {
  const { role, content } = message;
  const blocks: any[] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : [];

  // 用户消息：右对齐气泡
  if (role === "user") {
    const text = typeof content === "string" ? content : blocks.map((b) => b.text ?? "").join("");
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
    const text = blocks.map((b: any) => b.text ?? "").join("\n");
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
      {blocks.map((b: any, i: number) => {
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
        if (b.type === "toolCall") {
          const args = safeParse(b.arguments);
          const filePath = args?.path as string | undefined;
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
        }
        return null;
      })}
    </div>
  );
}
