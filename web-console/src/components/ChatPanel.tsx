// 主聊天区：虚拟列表消息流（ADR-018）+ 流式（StreamingText 独立订阅，token 不波及 ChatPanel）+ 输入区
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { MessageView } from "./MessageView.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import type { Theme } from "../hooks/useTheme.ts";
import type { ChatMessage, SessionState, ToolInfo } from "../types.ts";
import { useStreamText, useToolOutput } from "../state/streamStore.ts";

const BUILTIN_COMMANDS = [
  { name: "model", description: "切换模型", builtin: "model" as const },
  { name: "compact", description: "压缩上下文", builtin: "compact" as const },
  { name: "reload", description: "重载扩展/skills/prompts（保留对话）", builtin: "reload" as const },
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
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  // 注意：ChatPanel 不订阅 streamStore！流式 token 高频更新只由 <StreamingText> 独立处理，
  // 不触发 ChatPanel 重渲染（否则每 token 重渲染整个面板：顶栏+Virtuoso+StatusBar+输入区→卡）。

  useEffect(() => { setLoadingEarlier(false); }, [session?.messageOffset]);

  useEffect(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "auto", align: "end" });
  }, [sessionId]);

  // Virtuoso data 只含静态消息——token 不干扰虚拟列表（streamText 在 Footer 的 StreamingText 独立渲染）
  const items = useMemo(() => session?.messages ?? [], [session?.messages]);

  const filteredCmds = session && input.startsWith("/")
    ? [...BUILTIN_COMMANDS, ...session.commands]
        .filter((c) => c.name.toLowerCase().startsWith(input.slice(1).toLowerCase()))
        .slice(0, 12)
    : [];

  function send() {
    const text = input.trim();
    if (!text || !sessionId || session?.compacting) return;
    if (session?.streaming) onSteer(text);
    else onSend(text);
    setInput("");
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-3 pt-safe pb-2 lg:hidden">
        <button onClick={onToggleSidebar} className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-secondary hover:bg-surface-2" aria-label="打开侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>
        <span className="flex-1 truncate text-xs text-fg-tertiary">{session ? (session.cwd.split(/[\\/]/).pop() ?? "") : "pi Web Console"}</span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      {session ? (
        <Virtuoso<ChatMessage>
          ref={virtuosoRef}
          className="min-h-0 flex-1"
          data={items}
          firstItemIndex={session.prependCount || 0}
          computeItemKey={(_, item) => `${item.timestamp}-${item.role}`}
          itemContent={(_, item) => (
            <div className="px-3 py-1.5 lg:px-4 lg:py-2">
              {/* 按 toolCallId 取单值 patch 传给 MessageView（而非整个 patches Record）——
                  避免任一 edit/write 完成更新 session.patches 时，所有 MessageView memo 失效。 */}
              <MessageView message={item} onOpenFile={onOpenFile} patch={"toolCallId" in item ? session.patches[item.toolCallId] : undefined} />
            </div>
          )}
          components={{
            Header: () => (
              <div className="space-y-3 px-3 pt-3 lg:space-y-4 lg:px-4 lg:pt-4">
                {session.messageOffset > 0 && (
                  <div className="py-1 text-center text-xs text-fg-tertiary">{loadingEarlier ? "⏳ 加载中…" : "↑ 向上滚动加载更早的消息"}</div>
                )}
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
              </div>
            ),
            Footer: () => (
              <div className="space-y-3 px-3 pb-3 lg:space-y-4 lg:px-4 lg:pb-4">
                {/* 流式文本：独立子组件订阅 streamStore，token 更新只重渲染这里，不波及 ChatPanel/Virtuoso */}
                {sessionId && <StreamingText sessionId={sessionId} />}
                {Object.entries(session.tools).map(([id, tool]) => (
                  <ToolCard key={id} sessionId={sessionId!} id={id} tool={tool} />
                ))}
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
                {globalError && <div className="rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger">{globalError}</div>}
                {restarting && <div className="rounded-lg border border-info bg-info-soft p-3 text-sm text-info">服务正在重启，连接恢复后将自动继续…</div>}
              </div>
            ),
            EmptyPlaceholder: () => (
              <p className="mt-8 px-3 text-center text-sm text-fg-tertiary">{sessionOrderCount ? "（还没有消息，发送第一条吧）" : "点击左侧目录新建会话"}</p>
            ),
          }}
          followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
          startReached={() => {
            if (session.messageOffset > 0 && !loadingEarlier) {
              setLoadingEarlier(true);
              onLoadEarlier(session.messageOffset);
            }
          }}
          increaseViewportBy={{ top: 800, bottom: 800 }}
          defaultItemHeight={120}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 lg:p-4">
          <p className="mt-8 text-center text-sm text-fg-tertiary">{sessionOrderCount ? "选择一个会话" : "点击左侧目录新建会话"}</p>
          {globalError && <div className="rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger">{globalError}</div>}
          {restarting && <div className="rounded-lg border border-info bg-info-soft p-3 text-sm text-info">服务正在重启，连接恢复后将自动继续…</div>}
        </div>
      )}

      {session && (
        <StatusBar
          model={session.model}
          contextUsage={session.contextUsage}
          extensionStatuses={session.extensionStatuses}
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
          {session?.streaming && (
            <button onClick={onAbort} aria-label="停止" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger text-accent-contrast hover:opacity-90">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>
          )}
          <button onClick={send} disabled={!input.trim() || !session || session.compacting} aria-label={session?.streaming ? "补充" : "发送"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-40">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * 流式文本：独立订阅 streamStore（useSyncExternalStore），token 级高频更新只重渲染本组件。
 * ChatPanel 不订阅 streamStore → 流式时 ChatPanel/Virtuoso/StatusBar/输入区完全不重渲染。
 * 纯文本渲染（不解析 markdown）→ 每秒几十次 token 更新也极轻量。完成后文本入 messages（MessageView 渲染 markdown）。
 */
function StreamingText({ sessionId }: { sessionId: string }) {
  const streamText = useStreamText(sessionId);
  // 缓存 scroller DOM（避免每次 token 都 querySelector）+ rAF 节流（合并一帧内多次 token 为一次滚动）。
  // 此前每次 token 都 querySelector + 读 scrollHeight（强制布局）+ 写 scrollTop（再布局）= layout thrashing，
  // 每秒几十次，手机上严重卡顿。rAF 合并 + 读写在同一回调，浏览器一帧只布局一次。
  const scrollerRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!streamText) return;
    if (!scrollerRef.current) scrollerRef.current = document.querySelector('[data-testid="virtuoso-scroller"]');
    // 已有 pending rAF 则跳过（合并本帧内后续 token，一帧只滚一次）
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const scroller = scrollerRef.current;
      if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 500) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
  }, [streamText, sessionId]);
  // 卸载时取消未执行的 rAF，防泄漏
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);
  if (!streamText) return null;
  return (
    <div className="max-w-[92%] py-1.5">
      <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
        {streamText}
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-fg-tertiary align-middle" />
      </div>
    </div>
  );
}

const ToolCard = memo(function ToolCard({ sessionId, id, tool }: { sessionId: string; id: string; tool: ToolInfo }) {
  const output = useToolOutput(sessionId, id);
  return (
    <div className="max-w-[92%] rounded-md border bg-surface px-3 py-2 text-xs">
      <div className={`font-mono ${tool.status === "running" ? "text-warn" : tool.status === "error" ? "text-danger" : "text-ok"}`}>
        {tool.status === "running" ? "⏳" : tool.status === "error" ? "✗" : "✓"} {tool.name}
      </div>
      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-fg-tertiary">{typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args)}</pre>
      {output && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t pt-1 text-fg-secondary">{output.slice(-800)}</pre>}
    </div>
  );
});
