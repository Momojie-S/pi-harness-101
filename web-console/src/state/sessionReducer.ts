// 会话状态 reducer（重构 Step 2a）。
// 纯函数：所有跨组件状态变更的唯一入口。副作用（WS send、setTimeout）不在此。
// 设计依据：docs/design/modules/frontend-architecture.md §4。
import type { AgentMessage, AgentSessionEvent, ChatMessage, CommandInfo, ContextUsagePayload, DirEntry, ModelIdentity, ModelInfo, SessionInfo, SystemErrorMessage, SystemNoticeMessage } from "../types.ts";
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
    dirBrowser: { path: string; parent: string | null; dirs: { name: string; path: string }[] } | null;
    /** 正在打开的历史会话（防重复点击 + loading 反馈；session_opened/error 时清空） */
    openingSession: { cwd: string; path: string } | null;
    /** 正在加载的文件路径（read_file pending，loading 反馈 + 防重复） */
    pendingFile: string | null;
  };
  globalError: string | null;
  /** 服务正在重启（收到 restarting 消息后置 true，重连后清零） */
  restarting: boolean;
  /** 移动端侧边栏抽屉开关（PC 端始终显示，不受此控制） */
  sidebarOpen: boolean;
  /** 侧边栏「目录对话」视图：选定目录后加载其历史会话列表（ADR-009 扩展） */
  dirSessions: { cwd: string; list: SessionInfo[]; loading: boolean; visible: number } | null;
}

/** 侧边栏目录对话视图每页条数（滚动加载更多，ADR-009 扩展） */
const DIR_SESSIONS_PAGE = 20;

export function newSessionState(cwd: string): SessionState {
  return { cwd, sessionFile: undefined, messageTotal: 0, messageOffset: 0, messages: [], streaming: false, compacting: false, retrying: false, steeringQueue: [], restored: false, tools: {}, patches: {}, dirContents: {}, expandedDirs: new Set(), commands: [], model: null, contextUsage: null, extensionStatuses: {} };
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
    dirBrowser: null,
    openingSession: null,
    pendingFile: null,
  },
  globalError: null,
  restarting: false,
  sidebarOpen: false,
  dirSessions: null,
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
  | { type: "session_opened"; sessionId: string; cwd: string; sessionFile: string | undefined; messages: AgentMessage[]; messageTotal: number; messageOffset: number; model: ModelIdentity; contextUsage: ContextUsagePayload | null; dirContent: DirEntry[]; commands: CommandInfo[] }
  | { type: "session_closed"; sessionId: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "dir_content"; sessionId: string; path: string; entries: DirEntry[] }
  | { type: "commands"; sessionId: string; commands: CommandInfo[] }
  | { type: "models"; models: ModelInfo[] }
  | { type: "sessions_list"; cwd: string; sessions: SessionInfo[] }
  | { type: "entries_tree"; tree: EntryTreeNode[]; leafId: string | null }
  | { type: "model_changed"; sessionId: string; model: ModelIdentity }
  | { type: "context_usage"; sessionId: string; usage: ContextUsagePayload }
  | { type: "set_extension_status"; sessionId: string; key: string; text: string | undefined }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "system_notice"; sessionId: string; content: string }
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
  | { type: "ui_dirbrowser_open" }
  | { type: "ui_dirbrowser_close" }
  | { type: "browse_result"; path: string; parent: string | null; dirs: { name: string; path: string }[] }
  | { type: "toggle_dir"; sessionId: string; dir: string }
  // —— 用户操作：移动端侧边栏 ——
  | { type: "toggle_sidebar" }
  | { type: "set_sidebar"; open: boolean }
  // —— 目录对话视图（侧边栏历史会话列表，ADR-009 扩展）——
  | { type: "dir_sessions_load"; cwd: string }
  | { type: "dir_sessions_more" }
  | { type: "dir_sessions_clear" }
  // —— 正在打开历史会话（loading + 防重复点击）——
  | { type: "ui_history_opening"; cwd: string; path: string }
  // —— 正在加载文件（read_file pending，loading 反馈 + 防重复）——
  | { type: "file_loading"; path: string }
  // —— 刷新恢复：后端发送活跃 session 列表 ——
  | { type: "sessions_active"; sessions: { sessionId: string; cwd: string; sessionFile: string | undefined; streaming: boolean; summary: string; messages: unknown[]; messageTotal: number; messageOffset: number; model: ModelIdentity | null }[] }
  // —— 分页：更早的历史消息片段到达 ——
  | { type: "earlier_messages"; sessionId: string; messages: AgentMessage[]; offset: number };

export function sessionReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "dirs":
      return { ...state, dirs: action.dirs };

    case "session_opened": {
      const existing = state.sessions[action.sessionId];
      const isNew = !existing;
      // 后端预取了根目录 + 命令（省 2 次 WS 往返），直接填入 dirContents / commands
      const session = existing
        ? { ...existing, cwd: action.cwd, sessionFile: action.sessionFile, messages: action.messages, messageTotal: action.messageTotal, messageOffset: action.messageOffset, model: action.model, contextUsage: action.contextUsage, dirContents: { [action.cwd]: action.dirContent }, commands: action.commands, extensionStatuses: {}, streaming: false, tools: {}, restored: false }
        : { ...newSessionState(action.cwd), sessionFile: action.sessionFile, messages: action.messages, messageTotal: action.messageTotal, messageOffset: action.messageOffset, model: action.model, contextUsage: action.contextUsage, dirContents: { [action.cwd]: action.dirContent }, commands: action.commands };
      return {
        ...state,
        sessions: { ...state.sessions, [action.sessionId]: session },
        sessionOrder: state.sessionOrder.includes(action.sessionId) ? state.sessionOrder : [...state.sessionOrder, action.sessionId],
        // 仅新会话才抢焦点（修现状重连 bug：重连复用不切焦点）+ 移动端关闭抽屉
        activeSessionId: isNew ? action.sessionId : state.activeSessionId,
        sidebarOpen: isNew ? false : state.sidebarOpen,
        ui: { ...state.ui, openingSession: null }, // 历史会话打开完成，清除 loading
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

    case "file_loading":
      // 同时设 fileViewer（Modal 立即弹出）+ pendingFile（标记 loading）。content 空，file_content 到达后填充。
      return { ...state, ui: { ...state.ui, fileViewer: { path: action.path, content: "" }, pendingFile: action.path } };

    case "file_content":
      return { ...state, ui: { ...state.ui, fileViewer: { path: action.path, content: action.content }, pendingFile: null } };

    case "dir_content":
      return updateSessionInState(state, action.sessionId, (s) => ({
        ...s,
        dirContents: { ...s.dirContents, [action.path]: action.entries },
      }));

    case "commands":
      return updateSessionInState(state, action.sessionId, (s) => ({ ...s, commands: action.commands }));

    case "models":
      return { ...state, models: action.models };

    case "sessions_list": {
      // 同时供 SessionPicker（historySessions）和侧边栏目录对话视图（dirSessions）
      const next: AppState = { ...state, historySessions: action.sessions };
      if (state.dirSessions?.loading && state.dirSessions.cwd === action.cwd) {
        next.dirSessions = { cwd: action.cwd, list: action.sessions, loading: false, visible: DIR_SESSIONS_PAGE };
      }
      return next;
    }
    case "dir_sessions_load":
      return { ...state, dirSessions: { cwd: action.cwd, list: [], loading: true, visible: DIR_SESSIONS_PAGE } };
    case "dir_sessions_more":
      if (!state.dirSessions) return state;
      return { ...state, dirSessions: { ...state.dirSessions, visible: state.dirSessions.visible + DIR_SESSIONS_PAGE } };
    case "dir_sessions_clear":
      return { ...state, dirSessions: null };

    case "ui_history_opening":
      return { ...state, ui: { ...state.ui, openingSession: { cwd: action.cwd, path: action.path } } };

    case "sessions_active": {
      // 刷新恢复：后端发送活跃 session 列表，前端恢复 sessionOrder + 创建占位 SessionState
      const newSessions = { ...state.sessions };
      const newOrder = [...state.sessionOrder];
      for (const info of action.sessions) {
        if (!newSessions[info.sessionId]) {
          // sessions_active 直接带首屏 messages——切换会话即时显示，不用等 open_session 往返（frp 抖动根因）
          newSessions[info.sessionId] = { ...newSessionState(info.cwd), sessionFile: info.sessionFile, streaming: info.streaming, summary: info.summary, messages: info.messages as ChatMessage[], messageTotal: info.messageTotal, messageOffset: info.messageOffset, model: info.model };
        }
        if (!newOrder.includes(info.sessionId)) newOrder.push(info.sessionId);
      }
      // 无活跃 session 时自动选中第一个（触发自动加载）
      const newActive = state.activeSessionId ?? (newOrder.length > 0 ? newOrder[0] : null);
      return { ...state, sessions: newSessions, sessionOrder: newOrder, activeSessionId: newActive };
    }

    case "earlier_messages":
      // 分页：更早的消息前置插入 + 更新偏移
      return updateSessionInState(state, action.sessionId, (s) => ({
        ...s,
        messages: [...action.messages, ...s.messages],
        messageOffset: action.offset,
      }));

    case "entries_tree":
      // 守卫：picker 关闭时丢弃（与现状 setTreePicker(prev => prev ? {...} : prev) 等价）
      if (state.ui.treePicker === null) return state;
      return { ...state, ui: { ...state.ui, treePicker: { ...state.ui.treePicker, tree: action.tree, leafId: action.leafId } } };

    case "error": {
      // error 作为消息按时间顺序插入消息流（和 TUI 一致：能看出什么时候出的问题）
      const errMsg: SystemErrorMessage = { role: "system-error", content: action.message, timestamp: Date.now() };
      // 同时清除 pendingFile（read_file 失败时不要残留 loading 状态）
      const base = { ...state, ui: { ...state.ui, pendingFile: null } };
      if (action.sessionId) {
        return updateSessionInState(base, action.sessionId, (s) => ({ ...s, messages: [...s.messages, errMsg] }));
      }
      return { ...base, globalError: action.message, ui: { ...base.ui, openingSession: null } };
    }

    case "clear_global_error":
      return { ...state, globalError: null };

    case "system_notice":
      // 成功/信息反馈，作为消息按时间顺序插入消息流（对称于 error）
      return updateSessionInState(state, action.sessionId, (s) => {
        const notice: SystemNoticeMessage = { role: "system-notice", content: action.content, timestamp: Date.now() };
        return { ...s, messages: [...s.messages, notice] };
      });

    case "set_restarting":
      return { ...state, restarting: action.restarting };

    case "model_changed":
      return updateSessionInState(state, action.sessionId, (s) => ({ ...s, model: action.model }));

    case "context_usage":
      return updateSessionInState(state, action.sessionId, (s) => ({ ...s, contextUsage: action.usage }));

    case "set_extension_status":
      // 扩展状态：text=undefined 清除该 key，否则设置
      return updateSessionInState(state, action.sessionId, (s) => {
        const statuses = { ...s.extensionStatuses };
        if (action.text === undefined) {
          delete statuses[action.key];
        } else {
          statuses[action.key] = action.text;
        }
        return { ...s, extensionStatuses: statuses };
      });

    case "set_active":
      return { ...state, activeSessionId: action.sessionId, sidebarOpen: false };

    case "append_user_message": {
      const msg = { role: "user", content: [{ type: "text", text: action.text }], timestamp: Date.now() } as AgentMessage;
      // 新消息提交成功时清除旧的 session 级 error（如之前的 compact-in-progress 已过期）
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

    case "ui_dirbrowser_open":
      return { ...state, ui: { ...state.ui, dirBrowser: { path: "", parent: null, dirs: [] } } };
    case "ui_dirbrowser_close":
      return { ...state, ui: { ...state.ui, dirBrowser: null } };
    case "browse_result":
      if (state.ui.dirBrowser === null) return state; // 守卫：浏览器已关闭则丢弃
      return { ...state, ui: { ...state.ui, dirBrowser: { path: action.path, parent: action.parent, dirs: action.dirs } } };

    case "toggle_dir":
      return updateSessionInState(state, action.sessionId, (s) => {
        const expanded = new Set(s.expandedDirs);
        if (expanded.has(action.dir)) expanded.delete(action.dir);
        else expanded.add(action.dir);
        return { ...s, expandedDirs: expanded };
      });

    case "toggle_sidebar":
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "set_sidebar":
      return { ...state, sidebarOpen: action.open };

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

    case "compaction_start":
      return updateSessionInState(state, sid, (s) => ({ ...s, compacting: true }));

    case "compaction_end":
      return updateSessionInState(state, sid, (s) => ({ ...s, compacting: false }));

    case "auto_retry_start":
      // 大模型限流/API 错误时 SDK 自动重试；显示「重试中」提示
      // pi 从 agent state 移除了错误消息并重试，前端同步移除（否则错误幽灵消息残留）
      return updateSessionInState(state, sid, (s) => {
        const msgs = [...s.messages];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i] as any;
          if (m.role === "assistant" && m.stopReason === "error") {
            msgs.splice(i, 1);
            break;
          }
        }
        return { ...s, retrying: true, messages: msgs };
      });

    case "auto_retry_end": {
      // 重试结束：成功则清除提示；失败则追加 error 到消息流时间线
      if (event.success) return updateSessionInState(state, sid, (s) => ({ ...s, retrying: false }));
      const errMsg: SystemErrorMessage = { role: "system-error", content: event.finalError ?? "重试失败", timestamp: Date.now() };
      return updateSessionInState(state, sid, (s) => ({ ...s, retrying: false, messages: [...s.messages, errMsg] }));
    }

    case "queue_update":
      // steer 队列状态（agent 投递后自动清空）
      return updateSessionInState(state, sid, (s) => ({ ...s, steeringQueue: [...event.steering] }));

    // message_start / message_update(text_delta) 已移至 streamStore（ADR-017）——
    // onServerMessage 直接写 streamStore，不 dispatch。这里不再处理，走 default return state。

    case "message_end":
      // pi 事件流会先推 user 的 message_start/end，再推 assistant。
      // user 消息已由 append_user_message 乐观追加，这里跳过避免重复。
      // streamText 的清空由 onServerMessage 调 streamStore.clearText 完成（见 ADR-017）。
      if (event.message.role === "user") return state;
      return updateSessionInState(state, sid, (s) => ({ ...s, messages: [...s.messages, event.message] }));

    case "tool_execution_start":
      return updateSessionInState(state, sid, (s) => ({
        ...s,
        tools: { ...s.tools, [event.toolCallId]: { name: event.toolName, args: event.args, status: "running" } },
      }));

    // tool_execution_update 的流式 output 已移至 streamStore（ADR-017）——
    // onServerMessage 直接写 streamStore.setToolOutput，不 dispatch。这里走 default return state。

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
