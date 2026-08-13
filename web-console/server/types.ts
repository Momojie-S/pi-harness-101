// 会话 entry 树节点（/tree /fork 用）
export interface EntryTreeNode {
  id: string;
  parentId: string | null;
  type: string;
  summary: string;
  timestamp: number;
  children: EntryTreeNode[];
}

// 前端 → 后端（多会话：操作都带 sessionId 指定目标会话）
export type ClientMessage =
  | { type: "list_dirs" }
  | { type: "open_session"; cwd: string; sessionId?: string }
  | { type: "close_session"; sessionId: string }
  | { type: "prompt"; sessionId: string; message: string }
  | { type: "steer"; sessionId: string; message: string }
  | { type: "follow_up"; sessionId: string; message: string }
  | { type: "abort"; sessionId: string }
  | { type: "read_file"; sessionId: string; path: string }
  | { type: "list_dir"; sessionId: string; path?: string }
  | { type: "browse_dir"; path?: string }
  | { type: "list_commands"; sessionId: string }
  | { type: "list_models"; sessionId: string }
  | { type: "set_model"; sessionId: string; provider: string; modelId: string }
  | { type: "compact"; sessionId: string }
  | { type: "reload_session"; sessionId: string } // 重载当前会话的扩展/skills/prompts（保留对话历史）
  | { type: "set_thinking"; sessionId: string; level: string }
  | { type: "list_sessions"; cwd: string }
  | { type: "open_history"; cwd: string; path: string }
  | { type: "list_entries"; sessionId: string }
  | { type: "navigate"; sessionId: string; targetId: string }
  | { type: "fork"; sessionId: string; entryId: string }
  | { type: "load_earlier"; sessionId: string; before: number }; // 分页：加载更早的消息（before = 当前最早消息在完整列表的索引）

// 后端 → 前端
export type ServerMessage =
  | { type: "dirs"; dirs: string[] }
  | { type: "sessions_active"; sessions: { sessionId: string; cwd: string; sessionFile: string | undefined; streaming: boolean; summary: string; messages: unknown[]; messageTotal: number; messageOffset: number; model: ModelIdentity | null }[] }
  | { type: "session_opened"; sessionId: string; cwd: string; sessionFile: string | undefined; messages: unknown[]; messageTotal: number; messageOffset: number; model: ModelIdentity; contextUsage: ContextUsagePayload | null; dirContent: { name: string; type: "file" | "dir"; path: string }[]; commands: { name: string; description?: string }[]; timing?: { loaderMs: number; createMs: number; totalMs: number } }
  | { type: "session_closed"; sessionId: string }
  | { type: "agent_event"; sessionId: string; event: unknown }
  | { type: "file_content"; path: string; content: string }
  | { type: "dir_content"; sessionId: string; path: string; entries: { name: string; type: "file" | "dir"; path: string }[] }
  | { type: "browse_result"; path: string; parent: string | null; dirs: { name: string; path: string }[] }
  | { type: "commands"; sessionId: string; commands: { name: string; description?: string }[] }
  | { type: "models"; sessionId: string; models: { provider: string; id: string; name: string }[] }
  | { type: "model_changed"; sessionId: string; model: ModelIdentity }
  | { type: "thinking_changed"; sessionId: string; level: string }
  | { type: "context_usage"; sessionId: string; usage: ContextUsagePayload }
  | { type: "sessions_list"; cwd: string; sessions: { path: string; name?: string; modified: string; messageCount: number; firstMessage: string }[] }
  | { type: "entries_tree"; sessionId: string; tree: EntryTreeNode[]; leafId: string | null }
  | { type: "reloaded"; sessionId: string; commands: { name: string; description?: string }[] } // reload 完成，带刷新后的命令列表
  | { type: "ui_notify"; sessionId: string; message: string; level: "info" | "warning" | "error" }
  | { type: "ui_set_status"; sessionId: string; key: string; text: string | undefined }
  | { type: "restarting"; sessionId: string }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "earlier_messages"; sessionId: string; messages: unknown[]; offset: number; hasMore: boolean }; // 分页：更早的消息片段

/** 当前模型的标识（provider/id/name 三元组） */
export interface ModelIdentity {
  provider: string;
  id: string;
  name: string;
}

/** Context 占用（与 SDK 的 ContextUsage 一致，扁平化便于 WS 传输） */
export interface ContextUsagePayload {
  /** 估算的当前 context tokens，null 表示未知（如刚 compact 完、尚未到下次 LLM 响应） */
  tokens: number | null;
  /** 模型的 context window 大小 */
  contextWindow: number;
  /** 占用百分比 [0,100]，tokens 为 null 时亦为 null */
  percent: number | null;
}
