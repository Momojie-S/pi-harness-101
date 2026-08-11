// 主聊天区（重构 Step 5）：消息流 + 流式 + 工具卡片 + 输入区 + 命令补全
import { useEffect, useRef, useState } from "react";
import { MessageView } from "./MessageView.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { StatusBar } from "./StatusBar.tsx";
import type { AgentMessage, SessionState } from "../types.ts";

const BUILTIN_COMMANDS = [
  { name: "model", description: "切换模型", builtin: "model" as const },
  { name: "compact", description: "压缩上下文", builtin: "compact" as const },
  { name: "thinking", description: "设置思考强度", builtin: "thinking" as const },
  { name: "resume", description: "切换到历史会话", builtin: "resume" as const },
  { name: "tree", description: "会话树（导航到历史节点）", builtin: "tree" as const },
  { name: "fork", description: "从历史节点分叉新会话", builtin: "fork" as const },
];

interface ChatPanelProps {
  sessionId: string | null;
  session: SessionState | null;
  sessionOrderCount: number;
  globalError: string | null;
  restarting: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
  onOpenFile: (p: string) => void;
  onCmdSelect: (cmd: { name: string; builtin?: string }) => void;
  onOpenModelPicker: () => void;
  onToggleSidebar: () => void;
}

export function ChatPanel({ sessionId, session, sessionOrderCount, globalError, restarting, onSend, onAbort, onOpenFile, onCmdSelect, onOpenModelPicker, onToggleSidebar }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [cmdIndex, setCmdIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session?.messages, session?.streamText]);

  const filteredCmds = session && input.startsWith("/")
    ? [...BUILTIN_COMMANDS, ...session.commands]
        .filter((c) => c.name.toLowerCase().startsWith(input.slice(1).toLowerCase()))
        .slice(0, 12)
    : [];

  function send() {
    const text = input.trim();
    if (!text || !sessionId) return;
    onSend(text);
    setInput("");
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/* 移动端顶栏：汉堡菜单按钮（PC 端隐藏） */}
      <div className="flex items-center gap-3 border-b border-slate-800 px-3 py-2 lg:hidden">
        <button onClick={onToggleSidebar} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800" aria-label="打开侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>
        <span className="text-xs text-slate-500">{session ? (session.cwd.split(/[\\/]/).pop() ?? "") : "pi Web Console"}</span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!session ? (
          <p className="mt-8 text-center text-sm text-slate-600">{sessionOrderCount ? "选择一个会话" : "点击左侧目录新建会话"}</p>
        ) : (
          <>
            {session.messages.map((m: AgentMessage, i: number) => (
              <MessageView key={i} message={m} onOpenFile={onOpenFile} patches={session.patches} />
            ))}
            {session.streamText && (
              <div className="max-w-[92%]">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {session.streamText}
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-slate-400 align-middle" />
                </p>
              </div>
            )}
            {Object.entries(session.tools).map(([id, tool]) => (
              <div key={id} className="max-w-[92%] rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs">
                <div className={`font-mono ${tool.status === "running" ? "text-amber-400" : tool.status === "error" ? "text-red-400" : "text-green-400"}`}>
                  {tool.status === "running" ? "⏳" : tool.status === "error" ? "✗" : "✓"} {tool.name}
                </div>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-slate-400">{typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args)}</pre>
                {tool.output && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-slate-800 pt-1 text-slate-300">{tool.output.slice(-800)}</pre>}
              </div>
            ))}
            {session.error && <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{session.error}</div>}
          </>
        )}
        {globalError && <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{globalError}</div>}
        {restarting && <div className="rounded-lg border border-blue-800 bg-blue-950/40 p-3 text-sm text-blue-300">服务正在重启，连接恢复后将自动继续…</div>}
      </div>

      {/* 状态栏：模型 + context 占用（仅会话存在时） */}
      {session && (
        <StatusBar
          model={session.model}
          contextUsage={session.contextUsage}
          streaming={session.streaming}
          onModelClick={onOpenModelPicker}
        />
      )}

      <div className="relative border-t border-slate-800 p-3">
        <CommandPalette cmds={filteredCmds} cmdIndex={cmdIndex} onSelect={(c) => { if (c.builtin) { onCmdSelect(c); setInput(""); } else setInput("/" + c.name + " "); }} />
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => { setInput(e.target.value); setCmdIndex(0); }}
            onKeyDown={(e) => {
              if (filteredCmds.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setCmdIndex((i) => Math.min(i + 1, filteredCmds.length - 1)); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setCmdIndex((i) => Math.max(i - 1, 0)); return; }
                if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); onCmdSelect(filteredCmds[cmdIndex]); setInput(""); return; }
                if (e.key === "Escape") { setInput(""); return; }
              }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={session ? "输入消息…（/ 触发命令，Enter 发送）" : "先选择或新建会话"}
            disabled={!session}
            rows={1}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-slate-500 disabled:opacity-50"
          />
          {session?.streaming ? (
            <button onClick={onAbort} className="h-10 shrink-0 rounded-lg bg-red-600 px-4 text-sm font-medium hover:bg-red-500">停止</button>
          ) : (
            <button onClick={send} disabled={!input.trim() || !session} className="h-10 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-medium hover:bg-blue-500 disabled:opacity-40">发送</button>
          )}
        </div>
      </div>
    </main>
  );
}
