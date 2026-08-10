import { useEffect, useRef, useState } from "react";
import type { ClientMessage, EntryTreeNode, ServerMessage } from "../server/types.ts";
import { MessageView } from "./components/MessageView.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { EntryTree } from "./components/EntryTree.tsx";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

// 内置命令（不走 prompt，走 SDK 方法）
const BUILTIN_COMMANDS = [
  { name: "model", description: "切换模型", builtin: "model" as const },
  { name: "compact", description: "压缩上下文", builtin: "compact" as const },
  { name: "thinking", description: "设置思考强度", builtin: "thinking" as const },
  { name: "resume", description: "切换到历史会话", builtin: "resume" as const },
  { name: "tree", description: "会话树（导航到历史节点）", builtin: "tree" as const },
  { name: "fork", description: "从历史节点分叉新会话", builtin: "fork" as const },
];

interface ToolInfo {
  name: string;
  args: unknown;
  status: "running" | "done" | "error";
  output: string;
}
interface DirEntry {
  name: string;
  type: "file" | "dir";
  path: string;
}
interface SessionState {
  cwd: string;
  messages: any[];
  streamText: string;
  streaming: boolean;
  tools: Record<string, ToolInfo>;
  patches: Record<string, string>;
  dirContents: Record<string, DirEntry[]>;
  expandedDirs: Set<string>;
  error: string | null;
  commands: { name: string; description?: string }[];
}

function newSessionState(cwd: string): SessionState {
  return { cwd, messages: [], streamText: "", streaming: false, tools: {}, patches: {}, dirContents: {}, expandedDirs: new Set(), error: null, commands: [] };
}

export default function App() {
  const [sessions, setSessions] = useState<Record<string, SessionState>>({});
  const [sessionOrder, setSessionOrder] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [dirs, setDirs] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [fileViewer, setFileViewer] = useState<{ path: string; content: string } | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [cmdIndex, setCmdIndex] = useState(0);
  const [modelPicker, setModelPicker] = useState(false);
  const [models, setModels] = useState<{ provider: string; id: string; name: string }[]>([]);
  const [thinkingPicker, setThinkingPicker] = useState(false);
  const [sessionPicker, setSessionPicker] = useState(false);
  const [historySessions, setHistorySessions] = useState<{ path: string; name?: string; modified: string; messageCount: number; firstMessage: string }[]>([]);
  const [treePicker, setTreePicker] = useState<{ mode: "navigate" | "fork"; tree: EntryTreeNode[]; leafId: string | null } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolArgsRef = useRef<Record<string, unknown>>({});
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionOrderRef = useRef<string[]>([]);
  const sessionsRef = useRef<Record<string, SessionState>>({});

  const active = activeSessionId ? sessions[activeSessionId] : null;

  useEffect(() => { sessionOrderRef.current = sessionOrder; }, [sessionOrder]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  function updateSession(sid: string, updater: (s: SessionState) => SessionState) {
    setSessions((prev) => (prev[sid] ? { ...prev, [sid]: updater(prev[sid]) } : prev));
  }

  function setActive(id: string | null) {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }

  // WebSocket 连接 + 断线重连
  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let closed = false;
    const open = () => {
      socket = new WebSocket(WS_URL);
      wsRef.current = socket;
      socket.onopen = () => {
        setGlobalError(null);
        wsRef.current?.send(JSON.stringify({ type: "list_dirs" } satisfies ClientMessage));
        // 重连后重新订阅所有活跃会话（恢复事件流 + 拉最新 messages）
        for (const sid of sessionOrderRef.current) {
          const cwd = sessionsRef.current[sid]?.cwd;
          if (cwd) wsRef.current?.send(JSON.stringify({ type: "open_session", cwd, sessionId: sid } satisfies ClientMessage));
        }
      };
      socket.onmessage = (e) => onServer(JSON.parse(e.data) as ServerMessage);
      socket.onclose = () => {
        if (!closed) reconnectTimer = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onServer(msg: ServerMessage) {
    switch (msg.type) {
      case "dirs":
        setDirs(msg.dirs);
        break;
      case "session_opened":
        setSessions((prev) => {
          const existing = prev[msg.sessionId];
          return {
            ...prev,
            [msg.sessionId]: existing
              ? { ...existing, cwd: msg.cwd, messages: msg.messages as any[], error: null }
              : { ...newSessionState(msg.cwd), messages: msg.messages as any[] },
          };
        });
        setSessionOrder((prev) => (prev.includes(msg.sessionId) ? prev : [...prev, msg.sessionId]));
        setActive(msg.sessionId);
        wsRef.current?.send(JSON.stringify({ type: "list_dir", sessionId: msg.sessionId } satisfies ClientMessage));
        wsRef.current?.send(JSON.stringify({ type: "list_commands", sessionId: msg.sessionId } satisfies ClientMessage));
        break;
      case "session_closed":
        setSessions((prev) => {
          const n = { ...prev };
          delete n[msg.sessionId];
          return n;
        });
        setSessionOrder((prev) => prev.filter((s) => s !== msg.sessionId));
        if (activeSessionIdRef.current === msg.sessionId) setActive(null);
        break;
      case "agent_event":
        onAgentEvent(msg.sessionId, msg.event as any);
        break;
      case "file_content":
        setFileViewer({ path: msg.path, content: msg.content });
        break;
      case "dir_content":
        updateSession(msg.sessionId, (s) => ({ ...s, dirContents: { ...s.dirContents, [msg.path]: msg.entries as any[] } }));
        break;
      case "commands":
        updateSession(msg.sessionId, (s) => ({ ...s, commands: msg.commands }));
        break;
      case "models":
        setModels(msg.models);
        break;
      case "sessions_list":
        setHistorySessions(msg.sessions);
        break;
      case "entries_tree":
        setTreePicker((prev) => (prev ? { ...prev, tree: msg.tree, leafId: msg.leafId } : prev));
        break;
      case "error":
        if (msg.sessionId) updateSession(msg.sessionId, (s) => ({ ...s, error: msg.message }));
        else setGlobalError(msg.message);
        break;
    }
  }

  function onAgentEvent(sid: string, event: any) {
    switch (event.type) {
      case "agent_start":
        updateSession(sid, (s) => ({ ...s, streaming: true }));
        break;
      case "agent_settled":
        updateSession(sid, (s) => ({ ...s, streaming: false }));
        break;
      case "message_start":
        updateSession(sid, (s) => ({ ...s, streamText: "" }));
        break;
      case "message_update": {
        const ae = event.assistantMessageEvent;
        if (ae?.type === "text_delta") updateSession(sid, (s) => ({ ...s, streamText: s.streamText + ae.delta }));
        break;
      }
      case "message_end":
        updateSession(sid, (s) => ({ ...s, streamText: "", messages: [...s.messages, event.message] }));
        break;
      case "tool_execution_start":
        toolArgsRef.current[event.toolCallId] = event.args;
        updateSession(sid, (s) => ({ ...s, tools: { ...s.tools, [event.toolCallId]: { name: event.toolName, args: event.args, status: "running", output: "" } } }));
        break;
      case "tool_execution_update": {
        const partial = event.partialResult?.content?.map((c: any) => c.text).join("") ?? "";
        updateSession(sid, (s) => ({ ...s, tools: { ...s.tools, [event.toolCallId]: { ...s.tools[event.toolCallId], output: partial } } }));
        break;
      }
      case "tool_execution_end": {
        const patch = (event.result?.details as any)?.patch as string | undefined;
        updateSession(sid, (s) => {
          const tools = { ...s.tools };
          if (tools[event.toolCallId]) tools[event.toolCallId] = { ...tools[event.toolCallId], status: event.isError ? "error" : "done" };
          return { ...s, tools, patches: patch ? { ...s.patches, [event.toolCallId]: patch } : s.patches };
        });
        setTimeout(() => updateSession(sid, (s) => { const t = { ...s.tools }; delete t[event.toolCallId]; return { ...s, tools: t }; }), 1500);
        break;
      }
    }
  }

  // 新建会话（在某工作目录）
  function newSession(cwd: string) {
    wsRef.current?.send(JSON.stringify({ type: "open_session", cwd } satisfies ClientMessage));
  }
  function selectSession(sid: string) {
    setActive(sid);
  }
  function closeSession(sid: string) {
    wsRef.current?.send(JSON.stringify({ type: "close_session", sessionId: sid } satisfies ClientMessage));
  }

  function send() {
    const text = input.trim();
    if (!text || !wsRef.current || !activeSessionId) return;
    updateSession(activeSessionId, (s) => ({ ...s, messages: [...s.messages, { role: "user", content: text }] }));
    setInput("");
    wsRef.current.send(JSON.stringify({ type: "prompt", sessionId: activeSessionId, message: text } satisfies ClientMessage));
  }
  function abort() {
    if (activeSessionId) wsRef.current?.send(JSON.stringify({ type: "abort", sessionId: activeSessionId } satisfies ClientMessage));
  }

  function handleToggle(dir: string) {
    if (!activeSessionId || !active) return;
    if (active.expandedDirs.has(dir)) {
      updateSession(activeSessionId, (s) => ({ ...s, expandedDirs: new Set([...s.expandedDirs].filter((d) => d !== dir)) }));
    } else {
      updateSession(activeSessionId, (s) => ({ ...s, expandedDirs: new Set([...s.expandedDirs, dir]) }));
      if (!active.dirContents[dir]) wsRef.current?.send(JSON.stringify({ type: "list_dir", sessionId: activeSessionId, path: dir } satisfies ClientMessage));
    }
  }
  function handleOpenFile(p: string) {
    if (activeSessionId) wsRef.current?.send(JSON.stringify({ type: "read_file", sessionId: activeSessionId, path: p } satisfies ClientMessage));
  }

  // 选中命令：内置命令直接执行，skill/prompt 补全到输入框
  function handleCmdSelect(cmd: { name: string; builtin?: string }) {
    if (cmd.builtin === "compact") {
      if (activeSessionId) wsRef.current?.send(JSON.stringify({ type: "compact", sessionId: activeSessionId } satisfies ClientMessage));
      setInput("");
    } else if (cmd.builtin === "model") {
      setModelPicker(true);
      if (activeSessionId) wsRef.current?.send(JSON.stringify({ type: "list_models", sessionId: activeSessionId } satisfies ClientMessage));
      setInput("");
    } else if (cmd.builtin === "thinking") {
      setThinkingPicker(true);
      setInput("");
    } else if (cmd.builtin === "resume") {
      setSessionPicker(true);
      if (active?.cwd) wsRef.current?.send(JSON.stringify({ type: "list_sessions", cwd: active.cwd } satisfies ClientMessage));
      setInput("");
    } else if (cmd.builtin === "tree" || cmd.builtin === "fork") {
      setTreePicker({ mode: cmd.builtin === "tree" ? "navigate" : "fork", tree: [], leafId: null });
      if (activeSessionId) wsRef.current?.send(JSON.stringify({ type: "list_entries", sessionId: activeSessionId } satisfies ClientMessage));
      setInput("");
    } else {
      setInput("/" + cmd.name + " ");
    }
  }
  function handleModelSelect(provider: string, modelId: string) {
    if (activeSessionId) wsRef.current?.send(JSON.stringify({ type: "set_model", sessionId: activeSessionId, provider, modelId } satisfies ClientMessage));
    setModelPicker(false);
  }
  function handleThinkingSelect(level: string) {
    if (activeSessionId) wsRef.current?.send(JSON.stringify({ type: "set_thinking", sessionId: activeSessionId, level } satisfies ClientMessage));
    setThinkingPicker(false);
  }
  function handleHistorySelect(path: string) {
    if (active?.cwd) wsRef.current?.send(JSON.stringify({ type: "open_history", cwd: active.cwd, path } satisfies ClientMessage));
    setSessionPicker(false);
  }
  function handleEntrySelect(entryId: string) {
    if (!treePicker || !activeSessionId) return;
    if (treePicker.mode === "navigate") {
      wsRef.current?.send(JSON.stringify({ type: "navigate", sessionId: activeSessionId, targetId: entryId } satisfies ClientMessage));
    } else {
      wsRef.current?.send(JSON.stringify({ type: "fork", sessionId: activeSessionId, entryId } satisfies ClientMessage));
    }
    setTreePicker(null);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messages, active?.streamText]);

  // / 命令自动补全：输入 / 时过滤当前会话的可用命令
  const filteredCmds = active && input.startsWith("/")
    ? [...BUILTIN_COMMANDS, ...active.commands]
        .filter((c) => c.name.toLowerCase().startsWith(input.slice(1).toLowerCase()))
        .slice(0, 12)
    : [];

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100 lg:flex-row">
      <aside className="hidden border-r border-slate-800 p-4 lg:block lg:w-64 lg:shrink-0">
        <h2 className="mb-2 text-sm font-semibold text-slate-400">工作目录</h2>
        <div className="space-y-1">
          {dirs.length === 0 && <p className="text-xs text-slate-600">未配置（后端设 ALLOWED_DIRS）</p>}
          {dirs.map((d) => {
            const name = d.split(/[\\/]/).pop() ?? d;
            return (
              <button key={d} onClick={() => newSession(d)} className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-slate-400 hover:bg-slate-800" title={`在 ${d} 新建会话`}>
                ＋ {name}
              </button>
            );
          })}
        </div>

        <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-400">会话</h2>
        <div className="space-y-1">
          {sessionOrder.length === 0 && <p className="text-xs text-slate-600">点击上方目录新建</p>}
          {sessionOrder.map((sid) => {
            const s = sessions[sid];
            const name = s?.cwd.split(/[\\/]/).pop() ?? sid.slice(0, 6);
            const isActive = sid === activeSessionId;
            return (
              <div key={sid} className={`flex items-center rounded-md px-2 py-1 text-xs ${isActive ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"}`}>
                <button onClick={() => selectSession(sid)} className="flex-1 truncate text-left" title={s?.cwd}>
                  <span className={s?.streaming ? "text-amber-400" : ""}>{s?.streaming ? "● " : ""}{name}</span>
                </button>
                <button onClick={() => closeSession(sid)} className="ml-1 text-slate-500 hover:text-red-400">✕</button>
              </div>
            );
          })}
        </div>

        {active && (
          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-400">目录树</h2>
            <div className="max-h-[45vh] overflow-y-auto">
              <FileTree root={active.cwd} contents={active.dirContents} expanded={active.expandedDirs} onToggle={handleToggle} onOpenFile={handleOpenFile} />
            </div>
          </div>
        )}
      </aside>

      <main className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {!active ? (
            <p className="mt-8 text-center text-sm text-slate-600">{sessionOrder.length ? "选择一个会话" : "点击左侧目录新建会话"}</p>
          ) : (
            <>
              {active.messages.map((m, i) => (
                <MessageView key={i} message={m} onOpenFile={handleOpenFile} patches={active.patches} />
              ))}
              {active.streamText && (
                <div className="max-w-[92%]">
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {active.streamText}
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-slate-400 align-middle" />
                  </p>
                </div>
              )}
              {Object.entries(active.tools).map(([id, tool]) => (
                <div key={id} className="max-w-[92%] rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs">
                  <div className={`font-mono ${tool.status === "running" ? "text-amber-400" : tool.status === "error" ? "text-red-400" : "text-green-400"}`}>
                    {tool.status === "running" ? "⏳" : tool.status === "error" ? "✗" : "✓"} {tool.name}
                  </div>
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-slate-400">{typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args)}</pre>
                  {tool.output && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-slate-800 pt-1 text-slate-300">{tool.output.slice(-800)}</pre>}
                </div>
              ))}
              {active.error && <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{active.error}</div>}
            </>
          )}
          {globalError && <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{globalError}</div>}
        </div>

        <div className="relative border-t border-slate-800 p-3">
          {filteredCmds.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-1 max-h-60 overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 text-sm shadow-xl">
              {filteredCmds.map((c, i) => (
                <button key={c.name} onClick={() => handleCmdSelect(c)} className={`block w-full px-3 py-1.5 text-left ${i === cmdIndex ? "bg-slate-700" : "hover:bg-slate-800"}`}>
                  <span className="font-mono text-blue-400">/{c.name}</span>
                  {c.description && <span className="ml-2 text-xs text-slate-500">{c.description}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => { setInput(e.target.value); setCmdIndex(0); }}
              onKeyDown={(e) => {
                if (filteredCmds.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setCmdIndex((i) => Math.min(i + 1, filteredCmds.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setCmdIndex((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); handleCmdSelect(filteredCmds[cmdIndex]); return; }
                  if (e.key === "Escape") { setInput(""); return; }
                }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder={active ? "输入消息…（/ 触发命令，Enter 发送）" : "先选择或新建会话"}
              disabled={!active}
              rows={1}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-slate-500 disabled:opacity-50"
            />
            {active?.streaming ? (
              <button onClick={abort} className="h-10 shrink-0 rounded-lg bg-red-600 px-4 text-sm font-medium hover:bg-red-500">停止</button>
            ) : (
              <button onClick={send} disabled={!input.trim() || !active} className="h-10 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-medium hover:bg-blue-500 disabled:opacity-40">发送</button>
            )}
          </div>
        </div>
      </main>

      {fileViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setFileViewer(null)}>
          <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
              <span className="truncate font-mono text-xs text-slate-300">{fileViewer.path}</span>
              <button onClick={() => setFileViewer(null)} className="text-slate-400 hover:text-slate-100">✕ 关闭</button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-slate-200"><code>{fileViewer.content}</code></pre>
          </div>
        </div>
      )}
      {modelPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModelPicker(false)}>
          <div className="max-h-[70vh] w-full max-w-md overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-2" onClick={(e) => e.stopPropagation()}>
            <div className="px-2 py-1 text-xs text-slate-500">选择模型</div>
            {models.map((m) => (
              <button key={m.provider + m.id} onClick={() => handleModelSelect(m.provider, m.id)} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800">
                <span className="text-slate-200">{m.name}</span>
                <span className="ml-2 text-xs text-slate-500">{m.provider}/{m.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {thinkingPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setThinkingPicker(false)}>
          <div className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-900 p-2" onClick={(e) => e.stopPropagation()}>
            <div className="px-2 py-1 text-xs text-slate-500">思考强度</div>
            {["off", "minimal", "low", "medium", "high"].map((lvl) => (
              <button key={lvl} onClick={() => handleThinkingSelect(lvl)} className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800">{lvl}</button>
            ))}
          </div>
        </div>
      )}
      {sessionPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSessionPicker(false)}>
          <div className="max-h-[70vh] w-full max-w-lg overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-2" onClick={(e) => e.stopPropagation()}>
            <div className="px-2 py-1 text-xs text-slate-500">历史会话（点击打开）</div>
            {historySessions.length === 0 && <div className="px-2 py-2 text-sm text-slate-600">（无）</div>}
            {historySessions.map((s) => (
              <button key={s.path} onClick={() => handleHistorySelect(s.path)} className="block w-full rounded px-2 py-2 text-left hover:bg-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-200">{s.name || s.firstMessage.slice(0, 40) || "(无标题)"}</span>
                  <span className="text-xs text-slate-500">{new Date(s.modified).toLocaleDateString()}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{s.messageCount} 条 · {s.firstMessage.slice(0, 50)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {treePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setTreePicker(null)}>
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-slate-700 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-700 px-4 py-2 text-xs text-slate-400">
              {treePicker.mode === "navigate" ? "导航到历史节点（原地继续）" : "从历史节点分叉新会话"} · 点击选择
            </div>
            <div className="flex-1 overflow-auto p-2">
              {treePicker.tree.length === 0 ? (
                <div className="px-2 py-2 text-sm text-slate-600">加载中…</div>
              ) : (
                <EntryTree nodes={treePicker.tree} leafId={treePicker.leafId} onSelect={handleEntrySelect} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
