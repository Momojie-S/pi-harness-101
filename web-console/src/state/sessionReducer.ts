// 会话状态 reducer（重构 Step 2a）。
// 纯函数：所有跨组件状态变更的唯一入口。副作用（WS send、setTimeout）不在此。
// 设计依据：docs/design/modules/frontend-architecture.md §4。
import type { AgentMessage, AgentSessionEvent, CommandInfo, ContextUsagePayload, DirEntry, ModelIdentity, ModelInfo, SessionInfo } from "../types.ts";
import type { EntryTreeNode } from "../../server/types.ts";
import type { SessionState } from "../types.ts";

export interface AppState {
  sessions: Record<string, SessionState>;
  sessionOrder: string[];
  activeSessionId: string | null;
  dirs: string[];
  models: ModelInfo[];
  historySessions: SessionInfo[];
  ui: {
    fileViewer: { path: string; content: string } | null;
    modelPicker: boolean;
    thinkingPicker: boolean;
    sessionPicker: boolean;
    treePicker: { mode: "navigate" | "fork"; tree: EntryTreeNode[]; leafId: string | null } | null;
  };
  globalError: string | null;
  /** 服务正在重启（收到 restarting 消息后置 true，重连后清零） */
  restarting: boolean;
}

export function newSessionState(cwd: string): SessionState {
  return { cwd, messages: [], streamText: "", streaming: false, tools: {}, patches: {}, dirContents: {}, expandedDirs: new Set(), error: null, commands: [], model: null, contextUsage: null };
}

export const initialState: AppState = {
  sessions: {},
  sessionOrder: [],
  activeSessionId: null,
  dirs: [],
  models: [],
  historySessions: [],
  ui: {
    fileViewer: null,
    modelPicker: false,
    thinkingPicker: false,
    sessionPicker: false,
    treePicker: null,
  },
  globalError: null,
  restarting: false,
};

// —— 副作用辅助：返回新 SessionState（reducer 内用）——

function updateSessionInState(
  state: AppState,
  sid: string,
  updater: (s: SessionState) => SessionState,
): AppState {
  const old = state.sessions[sid];
  if (!old) return state;
  return { ...state, sessions: { ...state.sessions, [sid]: updater(old) } };
}

// —— Action ——（对应 onServer 11 case + agent_event + 用户操作）

export type Action =
  // —— onServer ——
  | { type: "dirs"; dirs: string[] }
  | { type: "session_opened"; sessionId: string; cwd: string; messages: AgentMessage[]; model: ModelIdentity }
  | { type: "session_closed"; sessionId: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "dir_content"; sessionId: string; path: string; entries: DirEntry[] }
  | { type: "commands"; sessionId: string; commands: CommandInfo[] }
  | { type: "models"; models: ModelInfo[] }
  | { type: "sessions_list"; sessions: SessionInfo[] }
  | { type: "entries_tree"; tree: EntryTreeNode[]; leafId: string | null }
  | { type: "model_changed"; sessionId: string; model: ModelIdentity }
  | { type: "context_usage"; sessionId: string; usage: ContextUsagePayload }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "clear_global_error" }
  | { type: "set_restarting"; restarting: boolean }
  // —— onAgentEvent（合并为单一 action，内 switch event.type）——
  | { type: "agent_event"; sessionId: string; event: AgentSessionEvent }
  // —— 用户操作：会话/消息 ——
  | { type: "set_active"; sessionId: string }
  | { type: "append_user_message"; sessionId: string; text: string }
  | { type: "drop_tool"; sessionId: string; toolCallId: string }
  // —— 用户操作：UI 开关 ——
  | { type: "ui_file_viewer_close" }
  | { type: "ui_picker_open"; which: "model" | "thinking" | "session" }
  | { type: "ui_picker_close"; which: "model" | "thinking" | "session" | "tree" }
  | { type: "ui_tree_open"; mode: "navigate" | "fork" }
  | { type: "toggle_dir"; sessionId: string; dir: string };

export function sessionReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "dirs":
      return { ...state, dirs: action.dirs };

    case "session_opened": {
      const existing = state.sessions[action.sessionId];
      const isNew = !existing;
      const session = existing
        ? { ...existing, cwd: action.cwd, messages: action.messages, error: null, model: action.model }
        : { ...newSessionState(action.cwd), messages: action.messages, model: action.model };
      return {
        ...state,
        sessions: { ...state.sessions, [action.sessionId]: session },
        sessionOrder: state.sessionOrder.includes(action.sessionId) ? state.sessionOrder : [...state.sessionOrder, action.sessionId],
        // 仅新会话才抢焦点（修现状重连 bug：重连复用不切焦点）
        activeSessionId: isNew ? action.sessionId : state.activeSessionId,
      };
    }

    case "session_closed": {
      const sessions = { ...state.sessions };
      delete sessions[action.sessionId];
      return {
        ...state,
        sessions,
        sessionOrder: state.sessionOrder.filter((s) => s !== action.sessionId),
        activeSessionId: state.activeSessionId === action.sessionId ? null : state.activeSessionId,
      };
    }

    case "file_content":
      return { ...state, ui: { ...state.ui, fileViewer: { path: action.path, content: action.content } } };

    case "dir_content":
      return updateSessionInState(state, action.sessionId, (s) => ({
        ...s,
        dirContents: { ...s.dirContents, [action.path]: action.entries },
      }));

    case "commands":
      return updateSessionInState(state, action.sessionId, (s) => ({ ...s, commands: action.commands }));

    case "models":
      return { ...state, models: action.models };

    case "sessions_list":
      return { ...state, historySessions: action.sessions };

    case "entries_tree":
      // 守卫：picker 关闭时丢弃（与现状 setTreePicker(prev => prev ? {...} : prev) 等价）
      if (state.ui.treePicker === null) return state;
      return { ...state, ui: { ...state.ui, treePicker: { ...state.ui.treePicker, tree: action.tree, leafId: action.leafId } } };

    case "error":
      if (action.sessionId) {
        return updateSessionInState(state, action.sessionId, (s) => ({ ...s, error: action.message }));
      }
      return { ...state, globalError: action.message };

    case "clear_global_error":
      return { ...state, globalError: null };

    case "set_restarting":
      return { ...state, restarting: action.restarting };

    case "model_changed":
      return updateSessionInState(state, action.sessionId, (s) => ({ ...s, model: action.model }));

    case "context_usage":
      return updateSessionInState(state, action.sessionId, (s) => ({ ...s, contextUsage: action.usage }));

    case "set_active":
      return { ...state, activeSessionId: action.sessionId };

    case "append_user_message": {
      const msg = { role: "user", content: [{ type: "text", text: action.text }], timestamp: Date.now() } as AgentMessage;
      return updateSessionInState(state, action.sessionId, (s) => ({ ...s, messages: [...s.messages, msg] }));
    }

    case "drop_tool":
      return updateSessionInState(state, action.sessionId, (s) => {
        const tools = { ...s.tools };
        delete tools[action.toolCallId];
        return { ...s, tools };
      });

    case "agent_event":
      return reduceAgentEvent(state, action.sessionId, action.event);

    case "ui_file_viewer_close":
      return { ...state, ui: { ...state.ui, fileViewer: null } };

    case "ui_picker_open":
      return { ...state, ui: { ...state.ui, [`${action.which}Picker`]: true } };

    case "ui_picker_close":
      if (action.which === "tree") return { ...state, ui: { ...state.ui, treePicker: null } };
      return { ...state, ui: { ...state.ui, [`${action.which}Picker`]: false } };

    case "ui_tree_open":
      return { ...state, ui: { ...state.ui, treePicker: { mode: action.mode, tree: [], leafId: null } } };

    case "toggle_dir":
      return updateSessionInState(state, action.sessionId, (s) => {
        const expanded = new Set(s.expandedDirs);
        if (expanded.has(action.dir)) expanded.delete(action.dir);
        else expanded.add(action.dir);
        return { ...s, expandedDirs: expanded };
      });

    default:
      return state;
  }
}

// onAgentEvent 的 8 个子类型（reducer 内 switch event.type）
function reduceAgentEvent(state: AppState, sid: string, event: AgentSessionEvent): AppState {
  switch (event.type) {
    case "agent_start":
      return updateSessionInState(state, sid, (s) => ({ ...s, streaming: true }));

    case "agent_settled":
      return updateSessionInState(state, sid, (s) => ({ ...s, streaming: false }));

    case "message_start":
      return updateSessionInState(state, sid, (s) => ({ ...s, streamText: "" }));

    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae?.type === "text_delta") return updateSessionInState(state, sid, (s) => ({ ...s, streamText: s.streamText + ae.delta }));
      return state;
    }

    case "message_end":
      // pi 事件流会先推 user 的 message_start/end，再推 assistant。
      // user 消息已由 append_user_message 乐观追加，这里跳过避免重复。
      if (event.message.role === "user") return updateSessionInState(state, sid, (s) => ({ ...s, streamText: "" }));
      return updateSessionInState(state, sid, (s) => ({ ...s, streamText: "", messages: [...s.messages, event.message] }));

    case "tool_execution_start":
      return updateSessionInState(state, sid, (s) => ({
        ...s,
        tools: { ...s.tools, [event.toolCallId]: { name: event.toolName, args: event.args, status: "running", output: "" } },
      }));

    case "tool_execution_update": {
      const partial = event.partialResult?.content?.map((c: any) => c.text).join("") ?? "";
      return updateSessionInState(state, sid, (s) => ({
        ...s,
        tools: { ...s.tools, [event.toolCallId]: { ...s.tools[event.toolCallId], output: partial } },
      }));
    }

    case "tool_execution_end": {
      const patch = (event.result?.details as any)?.patch as string | undefined;
      return updateSessionInState(state, sid, (s) => {
        const tools = { ...s.tools };
        if (tools[event.toolCallId]) tools[event.toolCallId] = { ...tools[event.toolCallId], status: event.isError ? "error" : "done" };
        return { ...s, tools, patches: patch ? { ...s.patches, [event.toolCallId]: patch } : s.patches };
      });
    }

    default:
      return state;
  }
}
