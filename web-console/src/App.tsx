import { useEffect, useReducer, useRef } from "react";
import type { ClientMessage } from "../server/types.ts";
import type { AppState } from "./state/sessionReducer.ts";
import { initialState, sessionReducer } from "./state/sessionReducer.ts";
import { useWebSocket } from "./hooks/useWebSocket.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { FileViewer } from "./components/pickers/FileViewer.tsx";
import { ModelPicker } from "./components/pickers/ModelPicker.tsx";
import { ThinkingPicker } from "./components/pickers/ThinkingPicker.tsx";
import { SessionPicker } from "./components/pickers/SessionPicker.tsx";
import { TreePicker } from "./components/pickers/TreePicker.tsx";

export default function App() {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  // ⚠ 单一 stateRef：仅供 WS 重连读快照（ADR-008）。其余一律走 dispatch。
  const stateRef = useRef<AppState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const { sessions, sessionOrder, activeSessionId, dirs, models, historySessions, ui, globalError, restarting } = state;
  const active = activeSessionId ? sessions[activeSessionId] : null;
  const ws = useWebSocket(dispatch, stateRef);

  // —— WS 回调（组件不直接持 wsClient，通过这些回调发消息）——
  const newSession = (cwd: string) => ws.send({ type: "open_session", cwd } satisfies ClientMessage);
  const closeSession = (sid: string) => ws.send({ type: "close_session", sessionId: sid } satisfies ClientMessage);
  const selectSession = (sid: string) => dispatch({ type: "set_active", sessionId: sid });
  const send = (text: string) => {
    if (!activeSessionId) return;
    dispatch({ type: "append_user_message", sessionId: activeSessionId, text });
    ws.send({ type: "prompt", sessionId: activeSessionId, message: text } satisfies ClientMessage);
  };
  const abort = () => activeSessionId && ws.send({ type: "abort", sessionId: activeSessionId } satisfies ClientMessage);
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
  const handleModelSelect = (provider: string, modelId: string) => {
    if (activeSessionId) ws.send({ type: "set_model", sessionId: activeSessionId, provider, modelId } satisfies ClientMessage);
    dispatch({ type: "ui_picker_close", which: "model" });
  };
  const handleThinkingSelect = (level: string) => {
    if (activeSessionId) ws.send({ type: "set_thinking", sessionId: activeSessionId, level } satisfies ClientMessage);
    dispatch({ type: "ui_picker_close", which: "thinking" });
  };
  const handleHistorySelect = (path: string) => {
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
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100 lg:flex-row">
      <Sidebar
        dirs={dirs}
        sessions={sessions}
        sessionOrder={sessionOrder}
        activeSessionId={activeSessionId}
        active={active}
        onNewSession={newSession}
        onSelectSession={selectSession}
        onCloseSession={closeSession}
        onToggleDir={handleToggle}
        onOpenFile={handleOpenFile}
      />
      <ChatPanel
        sessionId={activeSessionId}
        session={active}
        sessionOrderCount={sessionOrder.length}
        globalError={globalError}
        restarting={restarting}
        onSend={send}
        onAbort={abort}
        onOpenFile={handleOpenFile}
        onCmdSelect={handleCmdSelect}
        onOpenModelPicker={openModelPicker}
      />
      <FileViewer fileViewer={ui.fileViewer} onClose={() => dispatch({ type: "ui_file_viewer_close" })} />
      <ModelPicker open={ui.modelPicker} models={models} onSelect={handleModelSelect} onClose={() => dispatch({ type: "ui_picker_close", which: "model" })} />
      <ThinkingPicker open={ui.thinkingPicker} onSelect={handleThinkingSelect} onClose={() => dispatch({ type: "ui_picker_close", which: "thinking" })} />
      <SessionPicker open={ui.sessionPicker} sessions={historySessions} onSelect={handleHistorySelect} onClose={() => dispatch({ type: "ui_picker_close", which: "session" })} />
      <TreePicker open={!!ui.treePicker} mode={ui.treePicker?.mode ?? "navigate"} tree={ui.treePicker?.tree ?? []} leafId={ui.treePicker?.leafId ?? null} onSelect={handleEntrySelect} onClose={() => dispatch({ type: "ui_picker_close", which: "tree" })} />
    </div>
  );
}
