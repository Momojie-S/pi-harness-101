import { useEffect, useReducer, useRef, useState } from "react";
import type { ClientMessage } from "../server/types.ts";
import type { AppState } from "./state/sessionReducer.ts";
import { initialState, sessionReducer } from "./state/sessionReducer.ts";
import { useWebSocket } from "./hooks/useWebSocket.ts";
import { getRecentDirs, addRecentDir } from "./lib/recentDirs.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { FileViewer } from "./components/pickers/FileViewer.tsx";
import { ModelPicker } from "./components/pickers/ModelPicker.tsx";
import { ThinkingPicker } from "./components/pickers/ThinkingPicker.tsx";
import { SessionPicker } from "./components/pickers/SessionPicker.tsx";
import { TreePicker } from "./components/pickers/TreePicker.tsx";
import { useTheme } from "./hooks/useTheme.ts";
import { DirBrowser } from "./components/pickers/DirBrowser.tsx";

export default function App() {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  // ⚠ 单一 stateRef：仅供 WS 重连读快照（ADR-008）。其余一律走 dispatch。
  const stateRef = useRef<AppState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // 主题（亮/暗，ADR-010）：App 层调用一次，下传给 ThemeToggle
  const { theme, toggleTheme } = useTheme();

  const { sessions, sessionOrder, activeSessionId, dirs, models, historySessions, ui, globalError, restarting, sidebarOpen, dirSessions } = state;
  const active = activeSessionId ? sessions[activeSessionId] : null;
  const ws = useWebSocket(dispatch, stateRef);

  // 恢复的 session（刷新后从后端恢复）自动加载 messages
  useEffect(() => {
    if (activeSessionId && sessions[activeSessionId]?.restored) {
      ws.send({ type: "open_session", sessionId: activeSessionId, cwd: sessions[activeSessionId].cwd } satisfies ClientMessage);
    }
  }, [activeSessionId, sessions, ws]);

  // 「最近打开」工作目录（localStorage 持久化，纯前端，见 ADR-009）
  const [recentDirs, setRecentDirs] = useState<string[]>(() => getRecentDirs());

  // —— WS 回调（组件不直接持 wsClient，通过这些回调发消息）——
  const newSession = (cwd: string) => {
    const trimmed = cwd.trim();
    if (!trimmed) return;
    addRecentDir(trimmed);
    setRecentDirs(getRecentDirs());
    ws.send({ type: "open_session", cwd: trimmed } satisfies ClientMessage);
  };
  const closeSession = (sid: string) => ws.send({ type: "close_session", sessionId: sid } satisfies ClientMessage);
  const selectSession = (sid: string) => {
    dispatch({ type: "set_active", sessionId: sid });
    // 恢复的 session（messages 未加载）点击时加载
    const s = sessions[sid];
    if (s?.restored) ws.send({ type: "open_session", sessionId: sid, cwd: s.cwd } satisfies ClientMessage);
  };
  const send = (text: string) => {
    if (!activeSessionId) return;
    dispatch({ type: "append_user_message", sessionId: activeSessionId, text });
    ws.send({ type: "prompt", sessionId: activeSessionId, message: text } satisfies ClientMessage);
  };
  const abort = () => activeSessionId && ws.send({ type: "abort", sessionId: activeSessionId } satisfies ClientMessage);
  // steer：agent 工作中插入方向性指令（不打断当前工作，工具执行完后投递）
  const steer = (text: string) => {
    if (!activeSessionId) return;
    dispatch({ type: "append_user_message", sessionId: activeSessionId, text });
    ws.send({ type: "steer", sessionId: activeSessionId, message: text } satisfies ClientMessage);
  };
  // 分页：加载更早的历史消息（ChatPanel 滚动到顶部时触发）
  const loadEarlier = (before: number) => activeSessionId && ws.send({ type: "load_earlier", sessionId: activeSessionId, before } satisfies ClientMessage);
  const handleToggle = (dir: string) => {
    if (!activeSessionId || !active) return;
    dispatch({ type: "toggle_dir", sessionId: activeSessionId, dir });
    if (!active.expandedDirs.has(dir) && !active.dirContents[dir]) ws.send({ type: "list_dir", sessionId: activeSessionId, path: dir } satisfies ClientMessage);
  };
  const handleOpenFile = (p: string) => activeSessionId && ws.send({ type: "read_file", sessionId: activeSessionId, path: p } satisfies ClientMessage);

  function handleCmdSelect(cmd: { name: string; builtin?: string }) {
    if (cmd.builtin === "compact") {
      if (activeSessionId) ws.send({ type: "compact", sessionId: activeSessionId } satisfies ClientMessage);
    } else if (cmd.builtin === "model") {
      dispatch({ type: "ui_picker_open", which: "model" });
      if (activeSessionId) ws.send({ type: "list_models", sessionId: activeSessionId } satisfies ClientMessage);
    } else if (cmd.builtin === "thinking") {
      dispatch({ type: "ui_picker_open", which: "thinking" });
    } else if (cmd.builtin === "resume") {
      dispatch({ type: "ui_picker_open", which: "session" });
      if (active?.cwd) ws.send({ type: "list_sessions", cwd: active.cwd } satisfies ClientMessage);
    } else if (cmd.builtin === "tree" || cmd.builtin === "fork") {
      dispatch({ type: "ui_tree_open", mode: cmd.builtin === "tree" ? "navigate" : "fork" });
      if (activeSessionId) ws.send({ type: "list_entries", sessionId: activeSessionId } satisfies ClientMessage);
    }
  }
  // 打开模型选择器（复用 /model 命令逻辑）
  const openModelPicker = () => {
    dispatch({ type: "ui_picker_open", which: "model" });
    if (activeSessionId) ws.send({ type: "list_models", sessionId: activeSessionId } satisfies ClientMessage);
  };
  // 目录浏览选择器（ADR-009）：打开拉默认根；逐级浏览；选中复用 newSession 建会话
  const openDirBrowser = () => {
    dispatch({ type: "ui_dirbrowser_open" });
    ws.send({ type: "browse_dir" } satisfies ClientMessage);
  };
  const browseInto = (p: string) => ws.send({ type: "browse_dir", path: p } satisfies ClientMessage);
  const selectDir = (cwd: string) => {
    dispatch({ type: "ui_dirbrowser_close" });
    loadDirSessions(cwd);
  };
  // 侧边栏目录点击 → 加载该目录的历史会话列表（dirSessions）
  const loadDirSessions = (cwd: string) => {
    dispatch({ type: "dir_sessions_load", cwd });
    ws.send({ type: "list_sessions", cwd } satisfies ClientMessage);
  };
  const loadMoreDirSessions = () => dispatch({ type: "dir_sessions_more" });
  const selectHistoryInDir = (path: string) => {
    if (!dirSessions || ui.openingSession) return; // 有会话正在打开时禁止重复点击
    // 已打开的会话直接切换（不再重新 open_history）
    const existingSid = sessionOrder.find((sid) => sessions[sid]?.sessionFile === path);
    if (existingSid) { dispatch({ type: "set_active", sessionId: existingSid }); return; }
    dispatch({ type: "ui_history_opening", cwd: dirSessions.cwd, path });
    ws.send({ type: "open_history", cwd: dirSessions.cwd, path } satisfies ClientMessage);
  };
  const newSessionInDir = () => { if (dirSessions) newSession(dirSessions.cwd); };
  const handleModelSelect = (provider: string, modelId: string) => {
    if (activeSessionId) ws.send({ type: "set_model", sessionId: activeSessionId, provider, modelId } satisfies ClientMessage);
    dispatch({ type: "ui_picker_close", which: "model" });
  };
  const handleThinkingSelect = (level: string) => {
    if (activeSessionId) ws.send({ type: "set_thinking", sessionId: activeSessionId, level } satisfies ClientMessage);
    dispatch({ type: "ui_picker_close", which: "thinking" });
  };
  const handleHistorySelect = (path: string) => {
    if (ui.openingSession || !active?.cwd) return; // 防重复
    dispatch({ type: "ui_history_opening", cwd: active.cwd, path });
    if (active?.cwd) ws.send({ type: "open_history", cwd: active.cwd, path } satisfies ClientMessage);
    dispatch({ type: "ui_picker_close", which: "session" });
  };
  const handleEntrySelect = (entryId: string) => {
    if (!ui.treePicker || !activeSessionId) return;
    if (ui.treePicker.mode === "navigate") ws.send({ type: "navigate", sessionId: activeSessionId, targetId: entryId } satisfies ClientMessage);
    else ws.send({ type: "fork", sessionId: activeSessionId, entryId } satisfies ClientMessage);
    dispatch({ type: "ui_picker_close", which: "tree" });
  };

  return (
    /* 全屏布局根容器（layout 铁律，详见 docs/design/modules/layout.md）：
       h-screen + overflow-hidden 锁死视口（子内容溢出不撑出页面级滚动条）；
       flex-col 移动端单栏 / lg:flex-row 桌面端侧边栏 + 主区并排 */
    <div className="flex h-screen overflow-hidden flex-col bg-canvas text-fg lg:flex-row">
      <Sidebar
        dirs={dirs}
        recentDirs={recentDirs}
        sessions={sessions}
        sessionOrder={sessionOrder}
        activeSessionId={activeSessionId}
        active={active}
        sidebarOpen={sidebarOpen}
        onNewSession={newSession}
        onSelectSession={selectSession}
        onCloseSession={closeSession}
        onToggleDir={handleToggle}
        onLoadDirSessions={loadDirSessions}
        onOpenFile={handleOpenFile}
        onOpenDirBrowser={openDirBrowser}
        dirSessions={dirSessions}
        onLoadMoreDirSessions={loadMoreDirSessions}
        onSelectHistoryInDir={selectHistoryInDir}
        onNewSessionInDir={newSessionInDir}
        openingSession={ui.openingSession}
        onCloseSidebar={() => dispatch({ type: "set_sidebar", open: false })}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <ChatPanel
        sessionId={activeSessionId}
        session={active}
        sessionOrderCount={sessionOrder.length}
        globalError={globalError}
        restarting={restarting}
        onSend={send}
        onSteer={steer}
        onAbort={abort}
        onLoadEarlier={loadEarlier}
        onOpenFile={handleOpenFile}
        onCmdSelect={handleCmdSelect}
        onOpenModelPicker={openModelPicker}
        onToggleSidebar={() => dispatch({ type: "toggle_sidebar" })}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <FileViewer fileViewer={ui.fileViewer} onClose={() => dispatch({ type: "ui_file_viewer_close" })} />
      <ModelPicker open={ui.modelPicker} models={models} onSelect={handleModelSelect} onClose={() => dispatch({ type: "ui_picker_close", which: "model" })} />
      <ThinkingPicker open={ui.thinkingPicker} onSelect={handleThinkingSelect} onClose={() => dispatch({ type: "ui_picker_close", which: "thinking" })} />
      <SessionPicker open={ui.sessionPicker} sessions={historySessions} onSelect={handleHistorySelect} onClose={() => dispatch({ type: "ui_picker_close", which: "session" })} />
      <TreePicker open={!!ui.treePicker} mode={ui.treePicker?.mode ?? "navigate"} tree={ui.treePicker?.tree ?? []} leafId={ui.treePicker?.leafId ?? null} onSelect={handleEntrySelect} onClose={() => dispatch({ type: "ui_picker_close", which: "tree" })} />
      <DirBrowser
        state={ui.dirBrowser}
        onBrowse={browseInto}
        onSelect={selectDir}
        onClose={() => dispatch({ type: "ui_dirbrowser_close" })}
      />
    </div>
  );
}
