// 主聊天区（重构 Step 5）：消息流 + 流式 + 工具卡片 + 输入区 + 命令补全 + 主题切换
import { useEffect, useRef, useState } from "react";
import { MessageView } from "./MessageView.tsx";
import { Markdown } from "./Markdown.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import type { Theme } from "../hooks/useTheme.ts";
import type { ChatMessage, SessionState } from "../types.ts";

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
  onSteer: (text: string) => void;
  onAbort: () => void;
  onOpenFile: (p: string) => void;
  onCmdSelect: (cmd: { name: string; builtin?: string }) => void;
  onOpenModelPicker: () => void;
  onLoadEarlier: (before: number) => void;
  onToggleSidebar: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function ChatPanel({ sessionId, session, sessionOrderCount, globalError, restarting, onSend, onSteer, onAbort, onOpenFile, onCmdSelect, onOpenModelPicker, onLoadEarlier, onToggleSidebar, theme, onToggleTheme }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [cmdIndex, setCmdIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 分页：加载更早历史时保持滚动位置（非 null = 有待调整的增量）
  const pendingScrollAdj = useRef<number | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  // 滚动控制：前置历史时保持位置，其余（新消息/流式）滚到底
  useEffect(() => {
    if (pendingScrollAdj.current != null && scrollRef.current) {
      scrollRef.current.scrollTop += pendingScrollAdj.current;
      pendingScrollAdj.current = null;
      setLoadingEarlier(false);
      return;
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session?.messages, session?.streamText]);

  // 分页：滚动到顶部时加载更早的历史
  function handleScroll() {
    const el = scrollRef.current;
    if (!el || !session || loadingEarlier) return;
    if (el.scrollTop < 60 && session.messageOffset > 0) {
      setLoadingEarlier(true);
      pendingScrollAdj.current = el.scrollHeight; // 记录加载前高度，dispatch 后算增量
      onLoadEarlier(session.messageOffset);
    }
  }

  const filteredCmds = session && input.startsWith("/")
    ? [...BUILTIN_COMMANDS, ...session.commands]
        .filter((c) => c.name.toLowerCase().startsWith(input.slice(1).toLowerCase()))
        .slice(0, 12)
    : [];

  function send() {
    const text = input.trim();
    if (!text || !sessionId || session?.compacting) return;
    // agent 工作中 → steer（不打断）；空闲 → prompt
    if (session?.streaming) onSteer(text);
    else onSend(text);
    setInput("");
  }

  return (
    /* 主内容区（layout 铁律，详见 docs/design/modules/layout.md）：
       min-h-0：flex 子元素能收缩 + 内部滚动（flex 默认 min-height:auto 会阻止）；
       flex-1 + max-w-3xl + mx-auto：限宽 768px 居中——剩余空间 >768px 两侧留白对称，
       <768px（如 DevTools 挤压）均匀收窄（取舍见 ADR-011） */
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
      {/* 移动端顶栏：汉堡 + 标题 + 主题切换（PC 端隐藏） */}
      <div className="flex items-center gap-3 border-b px-3 pt-safe pb-2 lg:hidden">
        <button onClick={onToggleSidebar} className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-secondary hover:bg-surface-2" aria-label="打开侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>
        <span className="flex-1 truncate text-xs text-fg-tertiary">{session ? (session.cwd.split(/[\\/]/).pop() ?? "") : "pi Web Console"}</span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      {/* 消息流：min-h-0 + flex-1 弹性占剩余高度 + overflow-y-auto 内部滚动（layout.md 铁律②） */}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 lg:space-y-4 lg:p-4">
        {/* 分页：还有更早的历史可加载时，顶部显示加载提示 */}
        {session && session.messageOffset > 0 && (
          <div className="py-1 text-center text-xs text-fg-tertiary">{loadingEarlier ? "⏳ 加载中…" : "↑ 向上滚动加载更早的消息"}</div>
        )}
        {!session ? (
          <p className="mt-8 text-center text-sm text-fg-tertiary">{sessionOrderCount ? "选择一个会话" : "点击左侧目录新建会话"}</p>
        ) : (
          <>
            {session.compacting && (
              <div className="flex items-center gap-2 rounded-lg border border-fg-quaternary bg-surface-2 px-3 py-2 text-xs text-fg-secondary">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-fg-tertiary border-t-transparent" />
                正在压缩上下文…
              </div>
            )}
            {session.retrying && (
              <div className="flex items-center gap-2 rounded-lg border border-warn bg-warn-soft px-3 py-2 text-xs text-warn">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-warn border-t-transparent" />
                大模型限流/出错，自动重试中…
              </div>
            )}
            {session.messages.map((m: ChatMessage, i: number) => (
              <MessageView key={i} message={m} onOpenFile={onOpenFile} patches={session.patches} />
            ))}
            {session.streamText && (
              <div className="max-w-[92%]">
                <Markdown>{session.streamText}</Markdown>
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-fg-tertiary align-middle" />
              </div>
            )}
            {Object.entries(session.tools).map(([id, tool]) => (
              <div key={id} className="max-w-[92%] rounded-md border bg-surface px-3 py-2 text-xs">
                <div className={`font-mono ${tool.status === "running" ? "text-warn" : tool.status === "error" ? "text-danger" : "text-ok"}`}>
                  {tool.status === "running" ? "⏳" : tool.status === "error" ? "✗" : "✓"} {tool.name}
                </div>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-fg-tertiary">{typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args)}</pre>
                {tool.output && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t pt-1 text-fg-secondary">{tool.output.slice(-800)}</pre>}
              </div>
            ))}
            {/* 排队中的补充消息（steer 队列；agent 投递后自动消失） */}
            {session.steeringQueue.length > 0 && (
              <div className="rounded-lg border border-info bg-info-soft p-3 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-info">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-info border-t-transparent" />
                  排队中的补充消息（{session.steeringQueue.length}）
                </div>
                <ul className="mt-1.5 space-y-1">
                  {session.steeringQueue.map((q, i) => (
                    <li key={i} className="truncate text-fg-secondary" title={q}>• {q}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {globalError && <div className="rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger">{globalError}</div>}
        {restarting && <div className="rounded-lg border border-info bg-info-soft p-3 text-sm text-info">服务正在重启，连接恢复后将自动继续…</div>}
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

      <div className="relative border-t p-2 pb-safe lg:p-3">
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
            placeholder={session?.compacting ? "正在压缩上下文，请稍候…" : session ? (session.streaming ? "补充说明…（不打断当前工作）" : "输入消息…（/ 触发命令，Enter 发送）") : "先选择或新建会话"}
            disabled={!session || session.compacting}
            rows={1}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border-strong bg-surface px-3 py-2 text-sm outline-none placeholder-fg-tertiary focus:border-strong disabled:opacity-50"
          />
          {/* 停止（streaming 时，在发送左边） */}
          {session?.streaming && (
            <button onClick={onAbort} aria-label="停止" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger text-accent-contrast hover:opacity-90">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>
          )}
          {/* 发送 / 补充（始终在最右边，位置不变） */}
          <button onClick={send} disabled={!input.trim() || !session || session.compacting} aria-label={session?.streaming ? "补充" : "发送"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-40">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
          </button>
        </div>
      </div>
    </main>
  );
}
